import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chatDir } from '../paths.js';
import { createSession, getSession } from '../ai/sessions.js';

const MAP_DIR = chatDir;
const MAP_PATH = join(MAP_DIR, 'telegram-sessions.json');

type SessionMap = Record<string, string>; // chatId → sessionId

let cache: SessionMap | null = null;
let dirEnsured = false;

function ensureDir() {
  if (dirEnsured) return;
  mkdirSync(MAP_DIR, { recursive: true });
  dirEnsured = true;
}

function load(): SessionMap {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(MAP_PATH, 'utf-8')) as SessionMap;
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
    cache = {};
  }
  return cache;
}

function save(next: SessionMap) {
  ensureDir();
  const temporary = `${MAP_PATH}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    renameSync(temporary, MAP_PATH);
    cache = next;
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function getSessionId(chatId: number): string | undefined {
  return load()[String(chatId)];
}

export function setSessionId(chatId: number, sessionId: string): void {
  save({ ...load(), [String(chatId)]: sessionId });
}

export function clearSessionId(chatId: number): void {
  const map = { ...load() };
  delete map[String(chatId)];
  save(map);
}

/** Return all known Telegram chat IDs (for broadcasting alerts). */
export function getAllChatIds(): number[] {
  const map = load();
  return Object.keys(map)
    .map(Number)
    .filter((n) => !isNaN(n));
}

export function resolveSession(chatId: number): string {
  const existing = getSessionId(chatId);
  if (existing && getSession(existing)) return existing;
  const session = createSession();
  setSessionId(chatId, session.id);
  return session.id;
}
