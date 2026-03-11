/**
 * Cross-platform restore script for Money Monitor.
 * Extracts a tar.gz backup archive and restores files to the project root.
 *
 * Usage: node scripts/restore.mjs [path/to/backup.tar.gz]
 */
import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { extract, list } from 'tar';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

let archivePath;

if (process.argv[2]) {
  archivePath = process.argv[2];
} else {
  // Find the latest backup
  const backupDir = join(PROJECT_ROOT, 'backups');
  if (!existsSync(backupDir)) {
    console.error('Error: No backups directory found and no archive specified');
    console.error('Usage: node scripts/restore.mjs [path/to/backup.tar.gz]');
    process.exit(1);
  }

  const backups = readdirSync(backupDir)
    .filter((f) => f.startsWith('money-monitor-backup-') && f.endsWith('.tar.gz'))
    .sort()
    .reverse();

  if (backups.length === 0) {
    console.error(`Error: No backup archives found in ${backupDir}`);
    process.exit(1);
  }

  archivePath = join(backupDir, backups[0]);
  console.log(`Using latest backup: ${archivePath}`);
}

if (!existsSync(archivePath)) {
  console.error(`Error: Archive not found: ${archivePath}`);
  process.exit(1);
}

// Show contents
console.log('Contents:');
await list({ file: archivePath, onReadEntry: (entry) => console.log(`  ${entry.path}`) });
console.log('');

// Prompt for confirmation
const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await new Promise((resolve) => {
  rl.question(
    `Restore these files to ${PROJECT_ROOT}? This will overwrite existing files. [y/N] `,
    resolve,
  );
});
rl.close();

if (answer.toLowerCase() !== 'y') {
  console.log('Cancelled');
  process.exit(0);
}

// Extract
mkdirSync(join(PROJECT_ROOT, 'data'), { recursive: true });
await extract({ file: archivePath, cwd: PROJECT_ROOT });

// Rename snapshot back to production name
const snapshotPath = join(PROJECT_ROOT, 'data', 'money-monitor-backup.db');
if (existsSync(snapshotPath)) {
  renameSync(snapshotPath, join(PROJECT_ROOT, 'data', 'money-monitor.db'));
}

console.log('Restored successfully');
