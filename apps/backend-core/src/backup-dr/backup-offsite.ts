import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';

export type RemoteObject = { key: string; size: number };

/** Narrow seam over an S3-compatible bucket so the orchestration is testable without a network. */
export interface ObjectStore {
  readonly description: string;
  put(key: string, filePath: string, size: number, sha256: string): Promise<void>;
  head(key: string): Promise<{ size: number; sha256?: string } | null>;
  list(prefix: string): Promise<RemoteObject[]>;
  delete(key: string): Promise<void>;
}

export const MULTIPART_THRESHOLD = 32 * 1024 * 1024;
export const PART_SIZE = 16 * 1024 * 1024; // S3 min part is 5 MiB; 16 MiB * 10000 parts = 160 GB ceiling

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const base = opts.baseMs ?? 1000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (i < attempts - 1) await sleep(base * 2 ** i + Math.floor(Math.random() * base * 0.2));
    }
  }
  throw last;
}

/** Strips anything credential-like from an error message before it is logged or stored. */
export function sanitizeError(err: unknown): string {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return msg.replace(/(secret|token|password|signature|credential)[=:\s]+\S+/gi, '$1=***').slice(0, 300);
}

export type OffsiteConfig = { bucket: string; accessKeyId: string; secretAccessKey: string; region: string; endpoint?: string; prefix: string };

export function offsiteConfigFromEnv(env: NodeJS.ProcessEnv = process.env): OffsiteConfig | null {
  const bucket = env.BACKUP_S3_BUCKET;
  const accessKeyId = env.BACKUP_S3_ACCESS_KEY_ID;
  const secretAccessKey = env.BACKUP_S3_SECRET_ACCESS_KEY;
  if (!bucket || !accessKeyId || !secretAccessKey) return null;
  const envName = (env.BACKUP_ENV_NAME || 'prod').replace(/[^A-Za-z0-9_-]/g, '');
  const prefix = (env.BACKUP_S3_PREFIX || `exir-${envName}`).replace(/^\/+|\/+$/g, '');
  return { bucket, accessKeyId, secretAccessKey, region: env.BACKUP_S3_REGION || 'us-east-1', endpoint: env.BACKUP_S3_ENDPOINT || undefined, prefix };
}

export class S3ObjectStore implements ObjectStore {
  readonly description: string;
  constructor(
    private readonly client: Pick<S3Client, 'send'>,
    private readonly bucket: string,
    label = 'S3',
    private readonly sleep?: (ms: number) => Promise<void>,
  ) {
    this.description = `${label}:${bucket}`; // never include credentials
  }

  static fromConfig(cfg: OffsiteConfig): S3ObjectStore {
    const client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      forcePathStyle: cfg.endpoint ? true : undefined,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      maxAttempts: 3,
    });
    return new S3ObjectStore(client, cfg.bucket, cfg.endpoint ? 'S3-compatible' : 'AWS S3');
  }

  async put(key: string, filePath: string, size: number, sha256: string): Promise<void> {
    const Metadata = { sha256 };
    if (size <= MULTIPART_THRESHOLD) {
      await this.client.send(
        new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: createReadStream(filePath), ContentLength: size, ContentType: 'application/octet-stream', Metadata }),
      );
      return;
    }
    const created = await this.client.send(
      new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: 'application/octet-stream', Metadata }),
    );
    const uploadId = created.UploadId;
    if (!uploadId) throw new Error('S3 did not return an UploadId');
    const parts: { ETag: string; PartNumber: number }[] = [];
    const fh = await open(filePath, 'r');
    try {
      let offset = 0;
      let partNumber = 1;
      while (offset < size) {
        const len = Math.min(PART_SIZE, size - offset);
        const buf = Buffer.alloc(len);
        const { bytesRead } = await fh.read(buf, 0, len, offset);
        if (bytesRead !== len) throw new Error('short read while uploading backup part');
        const pn = partNumber;
        const res = await withRetry(() => this.client.send(new UploadPartCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumber: pn, Body: buf })), { sleep: this.sleep });
        if (!res.ETag) throw new Error('S3 part upload returned no ETag');
        parts.push({ ETag: res.ETag, PartNumber: pn });
        offset += len;
        partNumber += 1;
      }
      await this.client.send(new CompleteMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, MultipartUpload: { Parts: parts } }));
    } catch (err) {
      await this.client.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId })).catch(() => {});
      throw err;
    } finally {
      await fh.close();
    }
  }

  async head(key: string) {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: Number(res.ContentLength ?? -1), sha256: res.Metadata?.sha256 };
    } catch (err: any) {
      if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') return null;
      throw err;
    }
  }

  async list(prefix: string): Promise<RemoteObject[]> {
    const out: RemoteObject[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
      for (const o of res.Contents ?? []) if (o.Key) out.push({ key: o.Key, size: Number(o.Size ?? 0) });
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
