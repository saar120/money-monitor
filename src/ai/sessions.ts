import type { ReplyOperation } from './advisor-replies.js';
import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  appendFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { sessionsDir } from '../paths.js';
import type { AdvisorChart } from './advisor-chart.js';

const SESSIONS_DIR = sessionsDir;
const DEFAULT_TITLE = 'New chat';
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
  chart?: AdvisorChart;
  id?: string;
}

export interface Session {
  meta: SessionMeta;
  messages: SessionMessage[];
  replies?: ReplyOperation[];
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

function ensureDir() {
  mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 });
}

function sessionPath(id: string): string {
  if (!z.uuid().safeParse(id).success) throw new Error('Invalid session ID');
  return join(SESSIONS_DIR, `${id}.jsonl`);
}

function appendLine(filePath: string, data: object) {
  appendFileSync(filePath, JSON.stringify(data) + '\n', { mode: 0o600 });
}

function readLines(filePath: string): string[] {
  return readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
}

/** Rewrite the meta line (first line) in-place. Uses pre-read lines to avoid a second file read. */
function writeMeta(filePath: string, meta: SessionMeta, lines: string[]) {
  lines[0] = JSON.stringify(meta);
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, lines.join('\n') + '\n', { mode: 0o600, flag: 'wx' });
    renameSync(temporary, filePath);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function createSession(id: string = randomUUID()): SessionMeta {
  ensureDir();
  const existing = getSession(id);
  if (existing) return existing.meta;
  const now = new Date().toISOString();
  const meta: SessionMeta = {
    type: 'meta',
    id,
    title: DEFAULT_TITLE,
    createdAt: now,
    updatedAt: now,
  };
  appendLine(sessionPath(id), meta);
  return meta;
}

export function getSession(id: string): Session | null {
  let lines: string[];
  try {
    lines = readLines(sessionPath(id));
  } catch {
    return null;
  }
  if (lines.length === 0) return null;

  const meta = JSON.parse(lines[0]) as SessionMeta;
  const records = lines.slice(1).map((line) => JSON.parse(line) as SessionMessage | ReplyOperation);
  const messages = records.filter((record): record is SessionMessage => record.type === 'message');
  const replies = records.filter((record): record is ReplyOperation => record.type === 'reply');
  return { meta, messages, ...(replies.length ? { replies } : {}) };
}

export function listSessions(): SessionSummary[] {
  ensureDir();
  const files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.jsonl'));
  const summaries: SessionSummary[] = [];

  for (const file of files) {
    try {
      const firstLine = readFileSync(join(SESSIONS_DIR, file), 'utf-8').split('\n')[0];
      if (!firstLine) continue;
      const meta = JSON.parse(firstLine) as SessionMeta;
      if (
        meta.type !== 'meta' ||
        typeof meta.id !== 'string' ||
        file !== `${meta.id}.jsonl` ||
        typeof meta.title !== 'string' ||
        typeof meta.createdAt !== 'string' ||
        typeof meta.updatedAt !== 'string'
      )
        continue;
      summaries.push({
        id: meta.id,
        title: meta.title,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
      });
    } catch {
      // Skip corrupted files
    }
  }

  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function deleteSession(id: string): boolean {
  try {
    unlinkSync(sessionPath(id));
    return true;
  } catch {
    return false;
  }
}

export function appendMessage(
  id: string,
  role: 'user' | 'assistant',
  content: string,
  chart?: AdvisorChart,
): SessionMessage | null {
  if (!z.uuid().safeParse(id).success) return null;
  const path = sessionPath(id);
  const msg: SessionMessage = {
    type: 'message',
    role,
    content,
    timestamp: new Date().toISOString(),
    ...(chart ? { chart } : {}),
  };

  let lines: string[];
  try {
    lines = readLines(path);
    lines.push(JSON.stringify(msg));
  } catch {
    return null;
  }

  const meta = JSON.parse(lines[0]) as SessionMeta;
  meta.updatedAt = msg.timestamp;

  if (role === 'user' && meta.title === DEFAULT_TITLE) {
    meta.title = content.length > 60 ? content.slice(0, 57) + '...' : content;
  }

  writeMeta(path, meta, lines);
  return msg;
}

export function getSessionMessages(
  id: string,
): Array<{ role: 'user' | 'assistant'; content: string }> | null {
  const session = getSession(id);
  if (!session) return null;
  return session.messages.map((m) => ({ role: m.role, content: m.content }));
}

export function updateSession(id: string, change: (session: Session) => Session): Session | null {
  const current = getSession(id);
  if (!current) return null;
  const next = change(current);
  const lines = [
    JSON.stringify(next.meta),
    ...next.messages.map((message) => JSON.stringify(message)),
    ...(next.replies ?? []).map((operation) => JSON.stringify(operation)),
  ];
  writeMeta(sessionPath(id), next.meta, lines);
  return next;
}
