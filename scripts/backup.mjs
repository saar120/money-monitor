/** Standalone encrypted backup. MM_BACKUP_PASSPHRASE must be kept separately. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, copyFileSync, chmodSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { pack } from 'tar';
import { encryptBackup } from './backup-crypto.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(process.argv[2] || join(root, 'backups'));
const passphrase = process.env.MM_BACKUP_PASSPHRASE;
if (!passphrase || passphrase.length < 16)
  throw new Error('MM_BACKUP_PASSPHRASE must contain at least 16 characters');
const staging = mkdtempSync(join(tmpdir(), 'money-monitor-backup-'));
let archive;
try {
  mkdirSync(join(staging, 'data'), { mode: 0o700 });
  const files = [];
  const database = join(root, 'data', 'money-monitor.db');
  if (existsSync(database)) {
    const snapshot = join(staging, 'data', 'money-monitor-backup.db');
    // Fail instead of copying an inconsistent live database if sqlite3 is unavailable.
    execFileSync('sqlite3', [database, `.backup '${snapshot.replaceAll("'", "''")}'`], {
      stdio: 'pipe',
    });
    files.push('data/money-monitor-backup.db');
  }
  for (const name of ['data/credentials.enc', '.env']) {
    if (existsSync(join(root, name))) {
      copyFileSync(join(root, name), join(staging, name));
      chmodSync(join(staging, name), 0o600);
      files.push(name);
    }
  }
  if (!files.length) throw new Error('No standalone data found to back up');
  const tarball = join(staging, 'backup.tar.gz');
  await pack({ cwd: staging, gzip: true, file: tarball, portable: true }, files);
  chmodSync(tarball, 0o600);
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  archive = join(
    destination,
    `money-monitor-backup-${new Date().toISOString().replaceAll(':', '-')}.tar.gz.enc`,
  );
  await encryptBackup(tarball, archive, passphrase);
  console.log(`Encrypted backup created: ${archive}`);
} catch (error) {
  if (archive) rmSync(archive, { force: true });
  throw error;
} finally {
  rmSync(staging, { recursive: true, force: true });
}
