import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import {
  hardenOwnerOnlyDirectory,
  hardenOwnerOnlyFile,
  hardenOwnerOnlySqliteFiles,
} from './user-data-permissions.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Electron sets this before importing the backend.
// Standalone mode leaves it unset -> falls back to PROJECT_ROOT/data.
const electronDataDir = process.env.MONEY_MONITOR_DATA_DIR;
const DATA_DIR = electronDataDir || join(__dirname, '..', 'data');

mkdirSync(DATA_DIR, electronDataDir ? { recursive: true, mode: 0o700 } : { recursive: true });

export const usesElectronUserData = Boolean(electronDataDir);

export const dataDir = DATA_DIR;
export const dbPath = join(DATA_DIR, 'money-monitor.db');
export const credentialsPath = join(DATA_DIR, 'credentials.enc');
export const chatDir = join(DATA_DIR, 'chat');
export const sessionsDir = join(DATA_DIR, 'chat', 'sessions');
export const configPath = join(DATA_DIR, 'config.json');
export const demoDbPath = join(DATA_DIR, 'demo.db');

if (usesElectronUserData) {
  hardenOwnerOnlyDirectory(dataDir);
  hardenOwnerOnlyFile(configPath);
  hardenOwnerOnlyFile(credentialsPath);
  hardenOwnerOnlySqliteFiles(dbPath);
  hardenOwnerOnlySqliteFiles(demoDbPath);
}
