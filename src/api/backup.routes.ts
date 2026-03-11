import type { FastifyInstance } from 'fastify';
import { existsSync, mkdirSync, readdirSync, statSync, createReadStream, unlinkSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import * as tar from 'tar';
import { dataDir, dbPath, credentialsPath } from '../paths.js';

const backupsDir = join(dataDir, 'backups');

function ensureBackupsDir() {
  mkdirSync(backupsDir, { recursive: true });
}

export async function backupRoutes(app: FastifyInstance) {

  /** List available backups */
  app.get('/api/backups', async (_request, reply) => {
    ensureBackupsDir();

    const files = readdirSync(backupsDir)
      .filter(f => f.startsWith('money-monitor-backup-') && f.endsWith('.tar.gz'))
      .map(f => {
        const stat = statSync(join(backupsDir, f));
        return {
          filename: f,
          size: stat.size,
          createdAt: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return reply.send({ backups: files, backupsDir });
  });

  /** Create a new backup */
  app.post('/api/backup', async (request, reply) => {
    ensureBackupsDir();

    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').replace(/\..+/, '').replace(/(\d{8})(\d{6})/, '$1_$2');
    const archiveName = `money-monitor-backup-${timestamp}.tar.gz`;
    const archivePath = join(backupsDir, archiveName);
    const snapshotName = 'money-monitor-backup.db';
    const snapshotPath = join(dataDir, snapshotName);

    const filesToBackup: string[] = [];

    try {
      // Create a safe SQLite snapshot (handles WAL mode / active connections)
      if (existsSync(dbPath)) {
        execSync(`sqlite3 ${JSON.stringify(dbPath)} ".backup '${snapshotPath}'"`, {
          timeout: 30000,
        });
        filesToBackup.push(snapshotName);
      }

      // Include encrypted credentials if present
      if (existsSync(credentialsPath)) {
        filesToBackup.push('credentials.enc');
      }

      if (filesToBackup.length === 0) {
        return reply.status(400).send({ error: 'No files to back up' });
      }

      // Create tar.gz archive
      await tar.create(
        {
          gzip: true,
          file: archivePath,
          cwd: dataDir,
        },
        filesToBackup,
      );

      // Clean up snapshot
      if (existsSync(snapshotPath)) {
        unlinkSync(snapshotPath);
      }

      const stat = statSync(archivePath);

      return reply.send({
        success: true,
        backup: {
          filename: archiveName,
          size: stat.size,
          createdAt: stat.mtime.toISOString(),
          files: filesToBackup,
        },
      });
    } catch (err) {
      // Clean up snapshot on failure
      if (existsSync(snapshotPath)) {
        try { unlinkSync(snapshotPath); } catch {}
      }
      const msg = err instanceof Error ? err.message : String(err);
      request.log.error(err, 'Backup failed');
      return reply.status(500).send({ error: `Backup failed: ${msg}` });
    }
  });

  /** Download a backup file */
  app.get('/api/backups/:filename', async (request, reply) => {
    const { filename } = request.params as { filename: string };

    // Sanitize: only allow expected filenames
    if (!/^money-monitor-backup-\d{8}_\d{6}\.tar\.gz$/.test(filename)) {
      return reply.status(400).send({ error: 'Invalid backup filename' });
    }

    const filePath = join(backupsDir, filename);
    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: 'Backup not found' });
    }

    const stream = createReadStream(filePath);
    return reply
      .header('Content-Type', 'application/gzip')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(stream);
  });

  /** Delete a backup file */
  app.delete('/api/backups/:filename', async (request, reply) => {
    const { filename } = request.params as { filename: string };

    if (!/^money-monitor-backup-\d{8}_\d{6}\.tar\.gz$/.test(filename)) {
      return reply.status(400).send({ error: 'Invalid backup filename' });
    }

    const filePath = join(backupsDir, filename);
    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: 'Backup not found' });
    }

    unlinkSync(filePath);
    return reply.send({ success: true });
  });

  /** Restore from a backup */
  app.post('/api/restore', async (request, reply) => {
    const { filename } = request.body as { filename?: string };

    if (!filename) {
      return reply.status(400).send({ error: 'Backup filename is required' });
    }

    if (!/^money-monitor-backup-\d{8}_\d{6}\.tar\.gz$/.test(filename)) {
      return reply.status(400).send({ error: 'Invalid backup filename' });
    }

    const archivePath = join(backupsDir, filename);
    if (!existsSync(archivePath)) {
      return reply.status(404).send({ error: 'Backup not found' });
    }

    try {
      // Extract archive to data directory
      await tar.extract({
        file: archivePath,
        cwd: dataDir,
      });

      // Rename snapshot back to the expected database filename
      const snapshotPath = join(dataDir, 'money-monitor-backup.db');
      if (existsSync(snapshotPath)) {
        renameSync(snapshotPath, dbPath);
      }

      return reply.send({
        success: true,
        message: 'Backup restored. Please restart the application for changes to take effect.',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      request.log.error(err, 'Restore failed');
      return reply.status(500).send({ error: `Restore failed: ${msg}` });
    }
  });
}
