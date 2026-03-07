import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MAP_DIR = join(__dirname, '..', '..', 'data', 'chat');
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

function save() {
  ensureDir();
  writeFileSync(MAP_PATH, JSON.stringify(cache, null, 2) + '\n');
}

export function getSessionId(chatId: number): string | undefined {
  return load()[String(chatId)];
}

export function setSessionId(chatId: number, sessionId: string): void {
  const map = load();
  map[String(chatId)] = sessionId;
  save();
}

export function clearSessionId(chatId: number): void {
  const map = load();
  delete map[String(chatId)];
  save();
}
