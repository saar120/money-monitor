import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Electron sets this before importing the backend.
// Standalone mode leaves it unset -> falls back to PROJECT_ROOT/data.
const DATA_DIR = process.env.MONEY_MONITOR_DATA_DIR || join(__dirname, '..', 'data');

mkdirSync(DATA_DIR, { recursive: true });

export const dataDir = DATA_DIR;
export const dbPath = join(DATA_DIR, 'money-monitor.db');
export const credentialsPath = join(DATA_DIR, 'credentials.enc');
export const chatDir = join(DATA_DIR, 'chat');
export const sessionsDir = join(DATA_DIR, 'chat', 'sessions');
export const configPath = join(DATA_DIR, 'config.json');
export const demoDbPath = join(DATA_DIR, 'demo.db');
