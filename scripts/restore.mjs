/** Restore a standalone backup after authenticating and validating it. Stop the app first. */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  copyFileSync,
  chmodSync,
  lstatSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { extract, list } from 'tar';
import { decryptBackup } from './backup-crypto.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const allowPlaintext = args.includes('--allow-plaintext');
const supplied = args.find((arg) => !arg.startsWith('--'));
const backups = join(root, 'backups');
const latest = supplied
  ? null
  : readdirSync(backups)
      .filter((name) => name.startsWith('money-monitor-backup-') && name.endsWith('.tar.gz.enc'))
      .sort()
      .at(-1);
if (!supplied && !latest) throw new Error('No encrypted backup found');
const archive = supplied ? resolve(supplied) : join(backups, latest);
const staging = mkdtempSync(join(tmpdir(), 'money-monitor-restore-'));
const allowed = new Set(['data/money-monitor-backup.db', 'data/credentials.enc', '.env']);
try {
  let tarball = archive;
  if (archive.endsWith('.enc')) {
    tarball = join(staging, 'backup.tar.gz');
    await decryptBackup(archive, tarball, process.env.MM_BACKUP_PASSPHRASE);
  } else if (!allowPlaintext) {
    throw new Error('Legacy unencrypted backups require --allow-plaintext');
  }
  const names = new Set();
  await list({
    file: tarball,
    onReadEntry(entry) {
      if (!allowed.has(entry.path) || entry.type !== 'File' || names.has(entry.path))
        throw new Error('Unexpected backup entry');
      names.add(entry.path);
    },
  });
  if (!names.size) throw new Error('Empty backup');
  for (const suffix of ['-wal', '-shm', '-journal']) {
    if (existsSync(join(root, 'data', `money-monitor.db${suffix}`)))
      throw new Error('Stop the app and checkpoint the database before restoring');
  }
  // Never restore through a symlink into another location.
  for (const name of ['data', '.env', 'data/money-monitor.db', 'data/credentials.enc']) {
    try {
      if (lstatSync(join(root, name)).isSymbolicLink())
        throw new Error('Restore destination contains a symlink');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  console.log(`Validated files: ${[...names].join(', ')}`);
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  let answer;
  try {
    answer = await prompt.question(`Restore into ${root}, overwriting existing files? [y/N] `);
  } finally {
    prompt.close();
  }
  if (answer.toLowerCase() === 'y') {
    const extracted = join(staging, 'files');
    mkdirSync(extracted, { mode: 0o700 });
    await extract({
      file: tarball,
      cwd: extracted,
      filter: (path, entry) => allowed.has(path) && entry.type === 'File',
    });
    mkdirSync(join(root, 'data'), { recursive: true, mode: 0o700 });
    for (const name of names) {
      const destination = join(
        root,
        name === 'data/money-monitor-backup.db' ? 'data/money-monitor.db' : name,
      );
      copyFileSync(join(extracted, name), destination);
      chmodSync(destination, 0o600);
    }
    console.log('Restored successfully');
  } else console.log('Cancelled');
} finally {
  rmSync(staging, { recursive: true, force: true });
}
