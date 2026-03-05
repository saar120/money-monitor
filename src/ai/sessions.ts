import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SESSIONS_DIR = join(__dirname, '..', '..', 'data', 'chat', 'sessions');

export interface SessionMeta {
  type: 'meta';
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionMessage {
  type: 'message';
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface Session {
  meta: SessionMeta;
  messages: SessionMessage[];
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

function ensureDir() {
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

function sessionPath(id: string): string {
  return join(SESSIONS_DIR, `${id}.jsonl`);
}

function appendLine(filePath: string, data: object) {
  appendFileSync(filePath, JSON.stringify(data) + '\n');
}

function readLines(filePath: string): string[] {
  return readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
}

/** Rewrite the meta line (first line) in-place. */
function updateMeta(filePath: string, meta: SessionMeta) {
  const lines = readLines(filePath);
  lines[0] = JSON.stringify(meta);
  writeFileSync(filePath, lines.join('\n') + '\n');
}

export function createSession(): SessionMeta {
  ensureDir();
  const id = randomUUID();
  const now = new Date().toISOString();
  const meta: SessionMeta = { type: 'meta', id, title: 'New chat', createdAt: now, updatedAt: now };
  appendLine(sessionPath(id), meta);
  return meta;
}

export function getSession(id: string): Session | null {
  const path = sessionPath(id);
  if (!existsSync(path)) return null;
  const lines = readLines(path);
  if (lines.length === 0) return null;

  const meta = JSON.parse(lines[0]) as SessionMeta;
  const messages = lines.slice(1).map(l => JSON.parse(l) as SessionMessage);
  return { meta, messages };
}

export function listSessions(): SessionSummary[] {
  ensureDir();
  const files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.jsonl'));
  const summaries: SessionSummary[] = [];

  for (const file of files) {
    try {
      const firstLine = readFileSync(join(SESSIONS_DIR, file), 'utf-8').split('\n')[0];
      if (!firstLine) continue;
      const meta = JSON.parse(firstLine) as SessionMeta;
      summaries.push({ id: meta.id, title: meta.title, createdAt: meta.createdAt, updatedAt: meta.updatedAt });
    } catch {
      // Skip corrupted files
    }
  }

  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function deleteSession(id: string): boolean {
  const path = sessionPath(id);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

export function appendMessage(id: string, role: 'user' | 'assistant', content: string): SessionMessage | null {
  const path = sessionPath(id);
  if (!existsSync(path)) return null;

  const msg: SessionMessage = { type: 'message', role, content, timestamp: new Date().toISOString() };
  appendLine(path, msg);

  // Update the meta updatedAt
  const lines = readLines(path);
  const meta = JSON.parse(lines[0]) as SessionMeta;
  meta.updatedAt = msg.timestamp;

  // Auto-title: if this is the first user message, set title from content
  if (role === 'user') {
    const userMessages = lines.slice(1).filter(l => {
      try { return (JSON.parse(l) as SessionMessage).role === 'user'; } catch { return false; }
    });
    if (userMessages.length === 1) {
      meta.title = content.length > 60 ? content.slice(0, 57) + '...' : content;
    }
  }

  updateMeta(path, meta);
  return msg;
}

export function getSessionMessages(id: string): Array<{ role: 'user' | 'assistant'; content: string }> | null {
  const session = getSession(id);
  if (!session) return null;
  return session.messages.map(m => ({ role: m.role, content: m.content }));
}
