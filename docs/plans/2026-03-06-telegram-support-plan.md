# Telegram Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Telegram bot that provides the same AI chat functionality as the web UI, reusing the existing `chat()` generator, session system, and shared memory.

**Architecture:** A thin adapter layer in `src/telegram/` that maps Telegram chat IDs to existing sessions and pipes messages through the existing `chat()` async generator. The bot runs inside the same Fastify process, starts conditionally when `TELEGRAM_BOT_TOKEN` is set, and uses grammY for Telegram API interaction.

**Tech Stack:** grammY (Telegram bot framework), existing `@anthropic-ai/claude-agent-sdk` chat pipeline, JSONL session storage, `MEMORY.md` shared memory.

---

### Task 1: Install grammY and add config

**Files:**
- Modify: `package.json` (dependency)
- Modify: `src/config.ts:4-18` (add env vars)

**Step 1: Install grammY**

Run: `npm install grammy`

**Step 2: Add Telegram env vars to config schema**

In `src/config.ts`, add these two fields to the `envSchema` object, after the `CORS_ORIGIN` line:

```ts
TELEGRAM_BOT_TOKEN: z.string().optional(),
TELEGRAM_ALLOWED_USERS: z.string().optional(),
```

**Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add package.json package-lock.json src/config.ts
git commit -m "feat(telegram): install grammy and add config vars"
```

---

### Task 2: Create session-map module

**Files:**
- Create: `src/telegram/session-map.ts`

This module maps Telegram chat IDs → session UUIDs, persisted as a JSON file at `data/chat/telegram-sessions.json`. It maintains an in-memory cache and writes through to disk on every mutation.

**Step 1: Create `src/telegram/session-map.ts`**

```ts
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
```

**Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/telegram/session-map.ts
git commit -m "feat(telegram): add session-map module for chat-to-session persistence"
```

---

### Task 3: Create Telegram bot module

**Files:**
- Create: `src/telegram/bot.ts`

This is the main bot module. It sets up grammY, registers commands, handles text messages by piping them through the existing `chat()` generator, and exports `startTelegramBot()` and `stopTelegramBot()`.

**Step 1: Create `src/telegram/bot.ts`**

```ts
import { Bot } from 'grammy';
import { config } from '../config.js';
import { chat } from '../ai/agent.js';
import type { ChatMessage } from '../ai/agent.js';
import { readMemory } from '../ai/memory.js';
import {
  createSession,
  listSessions,
  appendMessage,
  getSessionMessages,
} from '../ai/sessions.js';
import { getSessionId, setSessionId, clearSessionId } from './session-map.js';

const MAX_MESSAGE_LENGTH = 4096;

let bot: Bot | null = null;

function parseAllowedUsers(): Set<number> {
  if (!config.TELEGRAM_ALLOWED_USERS) return new Set();
  return new Set(
    config.TELEGRAM_ALLOWED_USERS.split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(Number)
  );
}

/** Split text into chunks that fit Telegram's message limit. */
function splitMessage(text: string): string[] {
  if (text.length <= MAX_MESSAGE_LENGTH) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_MESSAGE_LENGTH) {
      chunks.push(remaining);
      break;
    }
    // Try to split at last newline within limit
    let splitAt = remaining.lastIndexOf('\n', MAX_MESSAGE_LENGTH);
    if (splitAt <= 0) splitAt = MAX_MESSAGE_LENGTH;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, '');
  }
  return chunks;
}

/** Resolve or create a session for a Telegram chat. */
function resolveSession(chatId: number): string {
  const existing = getSessionId(chatId);
  if (existing) return existing;
  const meta = createSession();
  setSessionId(chatId, meta.id);
  return meta.id;
}

/** Send a typing indicator at regular intervals until cancelled. */
function startTypingLoop(chatId: number, api: Bot['api']): () => void {
  let active = true;
  const tick = () => {
    if (!active) return;
    api.sendChatAction(chatId, 'typing').catch(() => {});
    setTimeout(tick, 4000);
  };
  tick();
  return () => { active = false; };
}

export function startTelegramBot(): void {
  if (!config.TELEGRAM_BOT_TOKEN) return;

  bot = new Bot(config.TELEGRAM_BOT_TOKEN);
  const allowedUsers = parseAllowedUsers();

  // ── Access control middleware ──
  if (allowedUsers.size > 0) {
    bot.use(async (ctx, next) => {
      const userId = ctx.from?.id;
      if (!userId || !allowedUsers.has(userId)) {
        await ctx.reply('Access denied.');
        return;
      }
      await next();
    });
  }

  // ── Commands ──

  bot.command('new', async (ctx) => {
    clearSessionId(ctx.chat.id);
    await ctx.reply('Session cleared. Your next message will start a new conversation.');
  });

  bot.command('memory', async (ctx) => {
    const memory = readMemory();
    if (!memory) {
      await ctx.reply('Memory is empty.');
      return;
    }
    for (const chunk of splitMessage(memory)) {
      await ctx.reply(chunk);
    }
  });

  bot.command('sessions', async (ctx) => {
    const sessions = listSessions();
    if (sessions.length === 0) {
      await ctx.reply('No sessions found.');
      return;
    }
    const currentSessionId = getSessionId(ctx.chat.id);
    const lines = sessions.slice(0, 20).map(s => {
      const marker = s.id === currentSessionId ? ' (active)' : '';
      const shortId = s.id.slice(0, 8);
      return `${shortId}${marker} — ${s.title}`;
    });
    await ctx.reply(lines.join('\n'));
  });

  bot.command('switch', async (ctx) => {
    const partialId = ctx.match?.trim();
    if (!partialId) {
      await ctx.reply('Usage: /switch <session-id-prefix>');
      return;
    }
    const sessions = listSessions();
    const match = sessions.find(s => s.id.startsWith(partialId));
    if (!match) {
      await ctx.reply(`No session found starting with "${partialId}".`);
      return;
    }
    setSessionId(ctx.chat.id, match.id);
    await ctx.reply(`Switched to session: ${match.title}`);
  });

  // ── Message handler ──

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    // Ignore messages that start with / (unrecognized commands)
    if (text.startsWith('/')) return;

    const chatId = ctx.chat.id;
    const sessionId = resolveSession(chatId);

    // Load history and append user message
    const history = getSessionMessages(sessionId) ?? [];
    appendMessage(sessionId, 'user', text);

    const conversationHistory: ChatMessage[] = [
      ...history,
      { role: 'user', content: text },
    ];

    const stopTyping = startTypingLoop(chatId, bot!.api);
    let result = '';

    try {
      for await (const event of chat(conversationHistory)) {
        if (event.type === 'result') {
          result = event.text;
        }
      }

      if (result) {
        appendMessage(sessionId, 'assistant', result);
        for (const chunk of splitMessage(result)) {
          await ctx.reply(chunk);
        }
      } else {
        await ctx.reply('No response generated. Please try again.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      await ctx.reply(`Error: ${message}`);
    } finally {
      stopTyping();
    }
  });

  // ── Register command menu in Telegram UI ──
  bot.api.setMyCommands([
    { command: 'new', description: 'Start a new conversation' },
    { command: 'memory', description: 'View shared memory' },
    { command: 'sessions', description: 'List recent sessions' },
    { command: 'switch', description: 'Switch to a session by ID prefix' },
  ]).catch(() => {});

  // ── Start long polling ──
  bot.start({
    onStart: () => console.log('Telegram bot started'),
  });
}

export function stopTelegramBot(): void {
  if (bot) {
    bot.stop();
    bot = null;
  }
}
```

**Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/telegram/bot.ts
git commit -m "feat(telegram): add bot module with commands and message handler"
```

---

### Task 4: Integrate bot into Fastify server lifecycle

**Files:**
- Modify: `src/index.ts:19` (import)
- Modify: `src/index.ts:148-151` (shutdown)
- Modify: `src/index.ts:157-163` (startup)

**Step 1: Add import at the top of `src/index.ts`**

After the existing imports (line 19), add:

```ts
import { startTelegramBot, stopTelegramBot } from './telegram/bot.js';
```

**Step 2: Add bot stop to the `shutdown()` function**

In the `shutdown()` function (around line 146), add `stopTelegramBot()` after `stopScheduler()`:

```ts
async function shutdown() {
  app.log.info('Shutting down...');
  stopScheduler();
  stopTelegramBot();
  await app.close();
  sqlite.close();
  process.exit(0);
}
```

**Step 3: Start bot after server listen**

In the `try` block after `app.listen()` succeeds (around line 159), add after `startScheduler()`:

```ts
startTelegramBot();
```

**Step 4: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat(telegram): integrate bot lifecycle into server startup and shutdown"
```

---

### Task 5: Manual smoke test

**Step 1: Set env vars**

Add to `.env`:
```
TELEGRAM_BOT_TOKEN=<your-bot-token-from-BotFather>
TELEGRAM_ALLOWED_USERS=<your-telegram-user-id>
```

To find your Telegram user ID, message `@userinfobot` on Telegram.

**Step 2: Start the server**

Run: `npm run dev`
Expected: Console shows `Telegram bot started` alongside the Fastify server startup.

**Step 3: Test commands in Telegram**

1. Open chat with your bot
2. Send `/sessions` → should reply with "No sessions found." or list existing sessions
3. Send a text message like "What did I spend last month?" → should get a financial analysis response
4. Send `/sessions` → should now show the new session
5. Send `/new` → should reply "Session cleared..."
6. Send another message → should start a fresh conversation
7. Send `/memory` → should show shared memory entries (if any)

**Step 4: Verify web UI still works**

Open the dashboard in browser, start a chat — confirm it works independently of Telegram.

**Step 5: Final commit (if any env/minor fixes needed)**

```bash
git add -A
git commit -m "feat(telegram): complete telegram bot integration"
```
