/**
 * Cross-platform backup script for Money Monitor.
 * Creates a tar.gz archive of the database, encrypted credentials, and .env file.
 *
 * Usage: node scripts/backup.mjs [backup-dir]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';
import { createWriteStream, createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { pack } from 'tar';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

const backupDir = process.argv[2] || join(PROJECT_ROOT, 'backups');
const timestamp = new Date().toISOString().replace(/[T:]/g, '_').replace(/\..+/, '');
const archivePath = join(backupDir, `money-monitor-backup-${timestamp}.tar.gz`);

const DB_FILE = join('data', 'money-monitor.db');
const DB_SNAPSHOT = join('data', 'money-monitor-backup.db');

process.chdir(PROJECT_ROOT);

// Collect files to back up
const files = [];

// Create a consistent SQLite snapshot (safe even with WAL mode / active connections)
if (existsSync(DB_FILE)) {
  try {
    execFileSync('sqlite3', [DB_FILE, `.backup '${DB_SNAPSHOT}'`], { stdio: 'pipe' });
    files.push(DB_SNAPSHOT);
  } catch {
    console.warn(`Warning: sqlite3 command failed, copying database file directly`);
    // Fallback: copy the file directly (less safe with active WAL connections)
    const { copyFileSync } = await import('node:fs');
    copyFileSync(DB_FILE, DB_SNAPSHOT);
    files.push(DB_SNAPSHOT);
  }
} else {
  console.warn(`Warning: ${DB_FILE} not found, skipping`);
}

for (const f of [join('data', 'credentials.enc'), '.env']) {
  if (existsSync(f)) {
    files.push(f);
  } else {
    console.warn(`Warning: ${f} not found, skipping`);
  }
}

if (files.length === 0) {
  console.error('Error: No files to back up');
  process.exit(1);
}

// Create backup directory
mkdirSync(backupDir, { recursive: true });

// Create tar.gz archive using the tar package
await pipeline(
  pack({ cwd: PROJECT_ROOT, gzip: true }, files),
  createWriteStream(archivePath),
);

// Clean up snapshot
if (existsSync(DB_SNAPSHOT)) {
  unlinkSync(DB_SNAPSHOT);
}

console.log(`Backup created: ${archivePath} (${files.join(', ')})`);
