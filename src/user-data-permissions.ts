import { chmodSync } from 'node:fs';

const OWNER_ONLY_DIRECTORY_MODE = 0o700;
const OWNER_ONLY_FILE_MODE = 0o600;
const SQLITE_FILE_SUFFIXES = ['', '-wal', '-shm', '-journal'] as const;

function isWindows(platform: NodeJS.Platform): boolean {
  return platform === 'win32';
}

function chmodIfPresent(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
}

/** Repair an existing Electron userData directory without changing Windows behavior. */
export function hardenOwnerOnlyDirectory(
  path: string,
  platform: NodeJS.Platform = process.platform,
): void {
  if (isWindows(platform)) return;
  chmodIfPresent(path, OWNER_ONLY_DIRECTORY_MODE);
}

/** Repair an existing sensitive Electron file without changing Windows behavior. */
export function hardenOwnerOnlyFile(
  path: string,
  platform: NodeJS.Platform = process.platform,
): void {
  if (isWindows(platform)) return;
  chmodIfPresent(path, OWNER_ONLY_FILE_MODE);
}

/** Repair a SQLite database and every companion file SQLite may leave beside it. */
export function hardenOwnerOnlySqliteFiles(
  path: string,
  platform: NodeJS.Platform = process.platform,
): void {
  if (isWindows(platform)) return;
  for (const suffix of SQLITE_FILE_SUFFIXES) {
    chmodIfPresent(`${path}${suffix}`, OWNER_ONLY_FILE_MODE);
  }
}
