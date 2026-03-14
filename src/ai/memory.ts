import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chatDir } from '../paths.js';

const MEMORY_DIR = chatDir;
const MEMORY_PATH = join(MEMORY_DIR, 'MEMORY.md');

function ensureDir() {
  if (!existsSync(MEMORY_DIR)) {
    mkdirSync(MEMORY_DIR, { recursive: true });
  }
}

export function readMemory(): string {
  ensureDir();
  if (!existsSync(MEMORY_PATH)) return '';
  return readFileSync(MEMORY_PATH, 'utf-8');
}

export function appendMemory(entry: string): void {
  ensureDir();
  const trimmed = entry.trim();
  if (!trimmed) return;
  const prefix = existsSync(MEMORY_PATH) && statSync(MEMORY_PATH).size > 0 ? '\n' : '';
  appendFileSync(MEMORY_PATH, `${prefix}- ${trimmed}\n`);
}

export function writeMemory(content: string): void {
  ensureDir();
  writeFileSync(MEMORY_PATH, content, 'utf-8');
}
