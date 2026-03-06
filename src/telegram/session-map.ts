import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MAP_DIR = join(__dirname, '..', '..', 'data', 'chat');
const MAP_PATH = join(MAP_DIR, 'telegram-sessions.json');

type SessionMap = Record<string, string>; // chatId → sessionId

let cache: SessionMap | null = null;

function load(): SessionMap {
  if (cache) return cache;
  if (!existsSync(MAP_PATH)) {
    cache = {};
    return cache;
  }
  cache = JSON.parse(readFileSync(MAP_PATH, 'utf-8')) as SessionMap;
  return cache;
}

function save() {
  mkdirSync(MAP_DIR, { recursive: true });
  writeFileSync(MAP_PATH, JSON.stringify(cache, null, 2) + '\n');
}

export function getSessionId(chatId: number): string | undefined {
  return load()[String(chatId)];
}

export function setSessionId(chatId: number, sessionId: string): void {
  load();
  cache![String(chatId)] = sessionId;
  save();
}

export function clearSessionId(chatId: number): void {
  load();
  delete cache![String(chatId)];
  save();
}
