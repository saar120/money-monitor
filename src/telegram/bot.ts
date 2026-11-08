import { Bot, InputFile, type Context } from 'grammy';
import type { ImageContent } from '@earendil-works/pi-ai';
import { config } from '../config.js';
import { discardReplyImages, getReplyImage } from '../ai/image-tools.js';
import { createHash } from 'node:crypto';
import { advisorReplies, ReplyAdmissionError } from '../ai/advisor-replies.js';
import {
  prepareTelegramDelivery,
  getTelegramDelivery,
  setTelegramText,
  deliverTelegram,
  latestRetryableTelegramDelivery,
  telegramDeliveryState,
  TelegramRejected,
  sendTelegramHtml,
  type TelegramDelivery,
} from './delivery.js';
import { chat } from '../ai/agent.js';
import { readMemory } from '../ai/memory.js';
import { listSessions, updateSession } from '../ai/sessions.js';
import {
  getSessionId,
  setSessionId,
  clearSessionId,
  getAllChatIds,
  resolveSession,
} from './session-map.js';
import { markdownToTelegramHtml, splitMessage } from './format.js';
import {
  registerSendMessage,
  registerGetChatIds,
  registerOnAlertSent,
  retryAlertDelivery,
} from './alerts.js';

let bot: Bot | null = null;
let polling: Promise<void> | null = null;
let transition: Promise<void> = Promise.resolve();
let desiredRunning = false;
let generation = 0;
const typingStops = new Set<() => void>();

function parseAllowedUsers(): Set<number> {
  if (!config.TELEGRAM_ALLOWED_USERS) return new Set();
  return new Set(
    config.TELEGRAM_ALLOWED_USERS.split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number),
  );
}

async function replyHtml(ctx: Context, html: string): Promise<void> {
  await sendTelegramHtml(
    (text, htmlMode) => ctx.reply(text, htmlMode ? { parse_mode: 'HTML' } : {}),
    html,
  );
}
function assertRecipient(chatId: number) {
  if (chatId <= 0 || !parseAllowedUsers().has(chatId))
    throw new TelegramRejected('Recipient is no longer authorized');
}
function assertOwner(instance: Bot, epoch: number) {
  if (!desiredRunning || generation !== epoch || bot !== instance)
    throw new TelegramRejected('Telegram owner retired');
}

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** Download a file from Telegram's API and return it as a base64-encoded ImageContent. */
async function downloadTelegramFile(
  instance: Bot,
  fileId: string,
  mimeType: string,
): Promise<ImageContent> {
  const file = await instance.api.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${config.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`Failed to download file: ${res.statusText}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return { type: 'image', data: buffer.toString('base64'), mimeType };
}

async function sendReply(value: TelegramDelivery, instance: Bot, epoch: number, retry = false) {
  return deliverTelegram(
    value.operationId,
    value.chatId,
    async (chunk) => {
      assertOwner(instance, epoch);
      assertRecipient(value.chatId);
      if (chunk.kind === 'text') {
        await sendTelegramHtml(
          (text, htmlMode) =>
            instance.api.sendMessage(value.chatId, text, htmlMode ? { parse_mode: 'HTML' } : {}),
          chunk.text,
        );
      } else {
        const image = getReplyImage(
          { replyId: value.operationId, recipientId: value.chatId, sessionId: value.sessionId },
          chunk.id,
        );
        await instance.api.sendPhoto(value.chatId, new InputFile(image.buffer, 'table.png'), {
          caption: image.caption,
        });
      }
    },
    undefined,
    retry,
  );
}

async function handleUserMessage(
  ctx: Context,
  instance: Bot,
  epoch: number,
  text: string,
  loadImages?: () => Promise<ImageContent[]>,
  historyText = text,
): Promise<void> {
  assertOwner(instance, epoch);
  const chatId = ctx.chat!.id;
  const digest = createHash('sha256').update(JSON.stringify(ctx.update)).digest('hex');
  const hex = createHash('sha256')
    .update(`telegram:${chatId}:${ctx.update.update_id}`)
    .digest('hex');
  const operationId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  const prior = getTelegramDelivery(operationId, chatId);
  const value = prepareTelegramDelivery(
    operationId,
    chatId,
    prior?.sessionId ?? resolveSession(chatId),
    digest,
  );
  const owner = { replyId: operationId, recipientId: chatId, sessionId: value.sessionId };
  const stopTyping = startTypingLoop(
    chatId,
    instance.api,
    () => desiredRunning && generation === epoch && bot === instance,
  );
  try {
    if (!value.textReady) {
      let response: string;
      try {
        const handle = advisorReplies.start(
          value.sessionId,
          { id: operationId, clientId: `telegram:${chatId}`, message: historyText },
          async function* (history, context) {
            const images = await loadImages?.();
            context.signal.throwIfAborted();
            yield* chat(history, images, {
              ...context,
              telegram: { chatId, sessionId: value.sessionId },
            });
          },
        );
        const outcome = await handle.completion;
        response =
          outcome.state === 'completed'
            ? outcome.text || 'No response generated. Send a new message to try again.'
            : 'The advisor could not finish this reply. Send a new message to try again.';
        if (outcome.state !== 'completed') discardReplyImages(owner);
      } catch (error) {
        if (!(error instanceof ReplyAdmissionError) || error.code !== 'reply_in_progress')
          throw error;
        response = 'The advisor is busy. Send your message again after the current reply finishes.';
      }
      setTelegramText(operationId, chatId, markdownToTelegramHtml(response));
    }
    assertOwner(instance, epoch);
    await sendReply(getTelegramDelivery(operationId, chatId)!, instance, epoch);
  } finally {
    stopTyping();
  }
}

export function startTypingLoop(chatId: number, api: Bot['api'], owns: () => boolean): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    typingStops.delete(stop);
  };
  const tick = async () => {
    if (stopped || !owns()) return;
    try {
      await api.sendChatAction(chatId, 'typing');
    } catch {
      /* Typing is advisory. */
    }
    if (!stopped && owns())
      timer = setTimeout(() => {
        void tick();
      }, 4000);
  };
  typingStops.add(stop);
  void tick();
  return stop;
}

function launchTelegramBot(epoch: number): void {
  if (!config.TELEGRAM_BOT_TOKEN || !desiredRunning || epoch !== generation || bot) return;
  const instance = new Bot(config.TELEGRAM_BOT_TOKEN);
  bot = instance;
  const allowedUsers = parseAllowedUsers();
  registerSendMessage(async (chatId, html) => {
    assertOwner(instance, epoch);
    assertRecipient(chatId);
    await sendTelegramHtml(
      (text, htmlMode) =>
        instance.api.sendMessage(chatId, text, htmlMode ? { parse_mode: 'HTML' } : {}),
      html,
    );
  });
  registerOnAlertSent(async (chatId, markdown, context, identity) => {
    assertRecipient(chatId);
    if (!identity) throw new Error('Alert delivery identity missing');
    await advisorReplies.whenIdle(identity.sessionId);
    const saved = updateSession(identity.sessionId, (session) => {
      const id = `alert:${identity.operationId}:assistant`;
      if (session.messages.some((message) => message.id === id)) return session;
      const now = new Date().toISOString();
      const messages = [...session.messages];
      if (!messages.length || messages.at(-1)?.role === 'assistant')
        messages.push({
          type: 'message',
          id: `alert:${identity.operationId}:context`,
          role: 'user',
          content: context ?? '[Automated financial alert]',
          timestamp: now,
        });
      messages.push({ type: 'message', id, role: 'assistant', content: markdown, timestamp: now });
      return { ...session, meta: { ...session.meta, updatedAt: now }, messages };
    });
    if (!saved) throw new Error('Alert conversation no longer exists');
  });
  registerGetChatIds(() => getAllChatIds().filter((id) => id > 0 && parseAllowedUsers().has(id)));

  // ── Access control middleware ──
  if (allowedUsers.size === 0) {
    console.warn('TELEGRAM_ALLOWED_USERS is not set — Telegram bot will ignore all messages.');
    instance.use(() => {});
  } else {
    instance.use(async (ctx, next) => {
      if (!desiredRunning || epoch !== generation || bot !== instance) return;
      const userId = ctx.from?.id;
      if (
        !userId ||
        !parseAllowedUsers().has(userId) ||
        ctx.chat?.type !== 'private' ||
        ctx.chat.id !== userId
      ) {
        return;
      }
      await next();
    });
  }

  // ── Commands ──

  instance.command('new', async (ctx) => {
    clearSessionId(ctx.chat.id);
    await ctx.reply('Session cleared. Your next message will start a new conversation.');
  });

  instance.command('memory', async (ctx) => {
    const memory = readMemory();
    if (!memory) {
      await ctx.reply('Memory is empty.');
      return;
    }
    for (const chunk of splitMessage(memory)) {
      await ctx.reply(chunk);
    }
  });

  instance.command('sessions', async (ctx) => {
    const sessions = listSessions();
    if (sessions.length === 0) {
      await ctx.reply('No sessions found.');
      return;
    }
    const currentSessionId = getSessionId(ctx.chat.id);
    const lines = sessions.slice(0, 20).map((s) => {
      const marker = s.id === currentSessionId ? ' (active)' : '';
      const shortId = s.id.slice(0, 8);
      return `${shortId}${marker} — ${s.title}`;
    });
    await ctx.reply(lines.join('\n'));
  });

  instance.command('switch', async (ctx) => {
    const partialId = ctx.match?.trim();
    if (!partialId) {
      await ctx.reply('Usage: /switch <session-id-prefix>');
      return;
    }
    const sessions = listSessions();
    const match = sessions.find((s) => s.id.startsWith(partialId));
    if (!match) {
      await ctx.reply(`No session found starting with "${partialId}".`);
      return;
    }
    setSessionId(ctx.chat.id, match.id);
    await ctx.reply(`Switched to session: ${match.title}`);
  });

  instance.command('alerts', async (ctx) => {
    const { loadAlertSettings } = await import('./alert-settings.js');
    const s = loadAlertSettings();
    const on = (v: boolean) => (v ? '✅' : '❌');
    const lines = [
      `**Alerts: ${on(s.enabled)}**`,
      `• Large charge threshold: ₪${s.largeChargeThreshold}`,
      `• Unusual spending threshold: ${s.unusualSpendingPercent}%`,
      `${on(s.monthlySummary.enabled)} Monthly summary (day ${s.monthlySummary.dayOfMonth})`,
      `${on(s.reportScrapeErrors)} Report scrape errors`,
    ];
    const html = markdownToTelegramHtml(lines.join('\n'));
    await replyHtml(ctx, html);
  });

  instance.command('retry', async (ctx) => {
    const value = latestRetryableTelegramDelivery(ctx.chat.id);
    if (!value) {
      await ctx.reply(
        'No safely retryable delivery found. Uncertain deliveries are not sent again.',
      );
      return;
    }
    const result = value.context
      ? await retryAlertDelivery(value)
      : await sendReply(value, instance, epoch, true);
    if (telegramDeliveryState(result) === 'sent') {
      const { reconcilePostImportAlert } = await import('../services/post-import.js');
      reconcilePostImportAlert(result.operationId);
    }
    if (telegramDeliveryState(result) !== 'sent')
      await ctx.reply('Delivery is still incomplete. Uncertain sends will not be repeated.');
  });

  // ── Message handlers ──

  instance.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return;
    await handleUserMessage(ctx, instance, epoch, text);
  });

  instance.on('message:photo', async (ctx) => {
    const photo = ctx.message.photo.at(-1)!;
    const caption = ctx.message.caption || "What's in this image?";
    await handleUserMessage(
      ctx,
      instance,
      epoch,
      caption,
      async () => [await downloadTelegramFile(instance, photo.file_id, 'image/jpeg')],
      `[Image] ${caption}`,
    );
  });
  instance.on('message:document', async (ctx) => {
    const doc = ctx.message.document;
    const mime = doc.mime_type ?? '';
    if (!IMAGE_MIME_TYPES.has(mime)) {
      await ctx.reply('Unsupported file type. I can only process images (JPEG, PNG, WebP, GIF).');
      return;
    }
    const caption = ctx.message.caption || "What's in this document?";
    await handleUserMessage(
      ctx,
      instance,
      epoch,
      caption,
      async () => [await downloadTelegramFile(instance, doc.file_id, mime)],
      `[Document: ${doc.file_name ?? 'image'}] ${caption}`,
    );
  });

  // ── Register command menu in Telegram UI ──
  instance.api
    .setMyCommands([
      { command: 'new', description: 'Start a new conversation' },
      { command: 'memory', description: 'View shared memory' },
      { command: 'sessions', description: 'List recent sessions' },
      { command: 'switch', description: 'Switch to a session by ID prefix' },
      { command: 'alerts', description: 'View alert settings' },
      { command: 'retry', description: 'Retry a known incomplete delivery' },
    ])
    .catch(() => {});

  // ── Catch unhandled errors so the polling loop keeps running ──
  instance.catch((err) => {
    console.error('[Telegram] Unhandled error in bot handler:', err.message ?? err);
  });

  // ── Start long polling ──
  polling = Promise.resolve(
    instance.start({ onStart: () => console.log('[Telegram] Bot started (long polling)') }),
  ).catch(() => {
    console.error('[Telegram] Polling stopped unexpectedly');
    if (bot === instance && generation === epoch) desiredRunning = false;
  });
}

async function haltTelegramBot() {
  const current = bot;
  if (!current) return;
  await current.stop();
  await polling;
  if (bot === current) {
    bot = null;
    polling = null;
  }
}
function requestLifecycle(mode: 'start' | 'stop' | 'restart'): Promise<void> {
  if (mode === 'start' && desiredRunning) return transition;
  desiredRunning = mode !== 'stop';
  const epoch = ++generation;
  for (const stop of [...typingStops]) stop();
  transition = transition
    .catch(() => {})
    .then(async () => {
      await haltTelegramBot();
      if (mode !== 'stop' && desiredRunning && epoch === generation) launchTelegramBot(epoch);
    });
  return transition;
}
export function startTelegramBot(): Promise<void> {
  return requestLifecycle('start');
}
export function stopTelegramBot(): Promise<void> {
  return requestLifecycle('stop');
}
export function restartTelegramBot(): Promise<void> {
  return requestLifecycle('restart');
}
