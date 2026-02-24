import Database, { type Database as BetterSqlite3Database } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { mkdirSync } from 'node:fs';

mkdirSync('data', { recursive: true });

const sqlite: BetterSqlite3Database = new Database('data/money-monitor.db');
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
export { sqlite };
