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
import { markdownToTelegramHtml } from './format.js';

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

/** Send a message with HTML formatting, falling back to plain text on parse errors. */
async function replyFormatted(ctx: { reply: (text: string, opts?: object) => Promise<unknown> }, text: string): Promise<void> {
  try {
    await ctx.reply(markdownToTelegramHtml(text), { parse_mode: 'HTML' });
  } catch {
    // If Telegram rejects our HTML (e.g. malformed tags), send as plain text
    await ctx.reply(text);
  }
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
  let timer: ReturnType<typeof setTimeout> | null = null;
  const tick = () => {
    api.sendChatAction(chatId, 'typing').catch(() => {});
    timer = setTimeout(tick, 4000);
  };
  tick();
  return () => { if (timer !== null) clearTimeout(timer); };
}

export function startTelegramBot(): void {
  if (!config.TELEGRAM_BOT_TOKEN) return;

  bot = new Bot(config.TELEGRAM_BOT_TOKEN);
  const allowedUsers = parseAllowedUsers();

  // ── Access control middleware ──
  if (allowedUsers.size === 0) {
    console.warn('TELEGRAM_ALLOWED_USERS is not set — Telegram bot is open to all users.');
  }
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
        } else if (event.type === 'error') {
          throw new Error(event.text);
        }
      }

      if (result) {
        appendMessage(sessionId, 'assistant', result);
        for (const chunk of splitMessage(result)) {
          await replyFormatted(ctx, chunk);
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
