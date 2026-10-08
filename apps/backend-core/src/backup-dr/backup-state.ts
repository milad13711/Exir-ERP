import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const DIR_MODE = 0o700;
export const FILE_MODE = 0o600;

export type OffsiteRecord = { key: string; at: string; size: number };
export type ManifestEntry = {
  sha256: string;
  size: number;
  createdAt: string;
  encrypted: boolean;
  offsite?: OffsiteRecord;
};
export type Manifest = { version: 1; entries: Record<string, ManifestEntry> };

export type TargetStatus = {
  lastSuccessAt?: string;
  lastFile?: string;
  lastSize?: number;
  encrypted?: boolean;
  offsite?: boolean;
  lastError?: string;
  lastErrorAt?: string;
};

export type RestoreTestResult = {
  at: string;
  target: string;
  file: string;
  ok: boolean;
  durationMs: number;
  detail: string;
};

export type BackupStatus = {
  version: 1;
  targets: Record<string, TargetStatus>;
  restoreTests: RestoreTestResult[];
  /** "YYYY-MM-DD:kind" -> true; dedupes alerts to one per kind per day */
  alertsSent: Record<string, true>;
  lastRunStartedAt?: string;
  lastRunFinishedAt?: string;
  offsiteLastOkAt?: string;
  offsiteLastError?: string;
  /** restore-check databases this job created and has not yet dropped */
  tempDbs?: string[];
};

export const emptyStatus = (): BackupStatus => ({ version: 1, targets: {}, restoreTests: [], alertsSent: {} });

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: DIR_MODE });
  await chmod(dir, DIR_MODE).catch(() => {});
}

export async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  await ensureDir(dirname(path));
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(data, null, 2), { mode: FILE_MODE });
  await chmod(tmp, FILE_MODE).catch(() => {});
  await rename(tmp, path);
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

export async function readManifest(dir: string): Promise<Manifest> {
  const m = await readJson<Manifest>(join(dir, 'manifest.json'));
  return m && m.version === 1 && m.entries ? m : { version: 1, entries: {} };
}
export const writeManifest = (dir: string, m: Manifest) => writeJsonAtomic(join(dir, 'manifest.json'), m);

export async function readStatus(root: string): Promise<BackupStatus> {
  const s = await readJson<BackupStatus>(join(root, '_status.json'));
  return s && s.version === 1 ? { ...emptyStatus(), ...s } : emptyStatus();
}
export const writeStatus = (root: string, s: BackupStatus) => writeJsonAtomic(join(root, '_status.json'), s);
