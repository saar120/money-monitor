import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  hardenOwnerOnlyDirectory,
  hardenOwnerOnlyFile,
  hardenOwnerOnlySqliteFiles,
} from './user-data-permissions.js';

const temporaryDirectories: string[] = [];

function makeTemporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), 'money-monitor-permissions-'));
  temporaryDirectories.push(path);
  return path;
}

function mode(path: string): number {
  return statSync(path).mode & 0o777;
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

const describePosix = process.platform === 'win32' ? describe.skip : describe;

describePosix('Electron userData permissions on POSIX', () => {
  it('repairs an existing directory, sensitive file, database, and SQLite sidecars', () => {
    const directory = makeTemporaryDirectory();
    const configPath = join(directory, 'config.json');
    const databasePath = join(directory, 'money-monitor.db');
    const sqlitePaths = [
      databasePath,
      `${databasePath}-wal`,
      `${databasePath}-shm`,
      `${databasePath}-journal`,
    ];

    chmodSync(directory, 0o755);
    writeFileSync(configPath, '{}', { mode: 0o644 });
    for (const path of sqlitePaths) writeFileSync(path, '', { mode: 0o644 });

    hardenOwnerOnlyDirectory(directory, 'darwin');
    hardenOwnerOnlyFile(configPath, 'darwin');
    hardenOwnerOnlySqliteFiles(databasePath, 'darwin');

    expect(mode(directory)).toBe(0o700);
    expect(mode(configPath)).toBe(0o600);
    for (const path of sqlitePaths) expect(mode(path)).toBe(0o600);
  });

  it('ignores missing sensitive files', () => {
    const directory = makeTemporaryDirectory();

    expect(() => hardenOwnerOnlyFile(join(directory, 'missing.json'), 'linux')).not.toThrow();
    expect(() => hardenOwnerOnlySqliteFiles(join(directory, 'missing.db'), 'linux')).not.toThrow();
  });

  it('leaves modes unchanged for the Windows branch', () => {
    const directory = makeTemporaryDirectory();
    const configPath = join(directory, 'config.json');
    chmodSync(directory, 0o755);
    writeFileSync(configPath, '{}', { mode: 0o644 });

    hardenOwnerOnlyDirectory(directory, 'win32');
    hardenOwnerOnlyFile(configPath, 'win32');

    expect(mode(directory)).toBe(0o755);
    expect(mode(configPath)).toBe(0o644);
  });
});
