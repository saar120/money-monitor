import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  appendFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { sessionsDir } from '../paths.js';
import type { AdvisorChart } from './advisor-chart.js';

const SESSIONS_DIR = sessionsDir;
const DEFAULT_TITLE = 'New chat';
const activeReplies = new Set<string>();

/** Keep desktop and mobile replies to one chat in order within the Mac process. */
export function beginSessionReply(id: string): boolean {
  if (activeReplies.has(id)) return false;
  activeReplies.add(id);
  return true;
}

export function endSessionReply(id: string): void {
  activeReplies.delete(id);
}

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
  mkdirSync(SESSIONS_DIR, { recursive: true });
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

/** Rewrite the meta line (first line) in-place. Uses pre-read lines to avoid a second file read. */
function writeMeta(filePath: string, meta: SessionMeta, lines: string[]) {
  lines[0] = JSON.stringify(meta);
  writeFileSync(filePath, lines.join('\n') + '\n');
}

export function createSession(): SessionMeta {
  ensureDir();
  const id = randomUUID();
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
  const messages = lines.slice(1).map((l) => JSON.parse(l) as SessionMessage);
  return { meta, messages };
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
    appendLine(path, msg);
    lines = readLines(path);
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
