import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface ServeOwnershipRecord {
  schemaVersion: 1;
  httpsPort: number;
  mountPath: string;
  lastKnownTarget: string | null;
  pendingTarget: string | null;
}

export interface ServeOwnershipStore {
  load(): Promise<ServeOwnershipRecord | null>;
  save(record: ServeOwnershipRecord): Promise<void>;
  clear(): Promise<void>;
}

function isValidRecord(value: unknown): value is ServeOwnershipRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;

  return (
    record.schemaVersion === 1 &&
    Number.isInteger(record.httpsPort) &&
    (record.httpsPort as number) > 0 &&
    (record.httpsPort as number) <= 65_535 &&
    typeof record.mountPath === 'string' &&
    record.mountPath.startsWith('/') &&
    (record.lastKnownTarget === null || typeof record.lastKnownTarget === 'string') &&
    (record.pendingTarget === null || typeof record.pendingTarget === 'string')
  );
}

/**
 * Durable proof that a Serve route was created by Money Monitor. The record is
 * deliberately tiny and contains no public URL, auth token, or financial data.
 */
export class FileServeOwnershipStore implements ServeOwnershipStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<ServeOwnershipRecord | null> {
    let contents: string;
    try {
      contents = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return null;
      throw error;
    }

    const parsed: unknown = JSON.parse(contents);
    if (!isValidRecord(parsed)) {
      throw new Error('Invalid Tailscale Serve ownership record');
    }
    return parsed;
  }

  async save(record: ServeOwnershipRecord): Promise<void> {
    if (!isValidRecord(record)) {
      throw new Error('Refusing to persist an invalid Tailscale Serve ownership record');
    }

    const directory = dirname(this.filePath);
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    await mkdir(directory, { recursive: true, mode: 0o700 });

    try {
      await writeFile(temporaryPath, `${JSON.stringify(record)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async clear(): Promise<void> {
    await rm(this.filePath, { force: true });
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
