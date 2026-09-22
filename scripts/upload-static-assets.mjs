// Uploads a Next.js build's .next/static directory to an S3-compatible
// object storage bucket, mirroring the path Next.js's own assetPrefix
// expects (<prefix>/_next/static/...). Run inside a container that already
// has @aws-sdk/client-s3 installed (see scripts/deploy-remote.sh — reuses
// the backend image's own node_modules rather than installing a new
// dependency just for this).
//
// Usage: node upload-static-assets.mjs <localDir> <endpoint> <bucket> <accessKeyId> <secretAccessKey> <destPrefix>
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';

const [, , localDir, endpoint, bucket, accessKeyId, secretAccessKey, destPrefix] = process.argv;
if (!localDir || !endpoint || !bucket || !accessKeyId || !secretAccessKey || !destPrefix) {
  console.error('Usage: node upload-static-assets.mjs <localDir> <endpoint> <bucket> <accessKeyId> <secretAccessKey> <destPrefix>');
  process.exit(1);
}

const CONTENT_TYPES = {
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
};

const client = new S3Client({
  region: 'default',
  endpoint,
  forcePathStyle: false,
  credentials: { accessKeyId, secretAccessKey },
});

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

let count = 0;
let failed = 0;
for await (const file of walk(localDir)) {
  const rel = relative(localDir, file).split('\\').join('/');
  const key = `${destPrefix}/${rel}`;
  try {
    const body = await readFile(file);
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    count++;
  } catch (err) {
    failed++;
    console.error(`FAILED: ${key}: ${err instanceof Error ? err.message : err}`);
  }
}
console.log(`Uploaded ${count} file(s) to ${bucket}/${destPrefix} (${failed} failed)`);
if (failed > 0) process.exit(1);
