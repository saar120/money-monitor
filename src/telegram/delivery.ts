import { GrammyError } from 'grammy';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { telegramDeliveries } from '../db/schema.js';
import { splitMessage } from './format.js';

export type ChunkState = 'pending' | 'sending' | 'sent' | 'failed' | 'unknown' | 'expired';
export type DeliveryChunk = { id: string; kind: 'text' | 'image'; text: string; state: ChunkState };
export type TelegramDelivery = {
  operationId: string;
  chatId: number;
  sessionId: string;
  questionDigest?: string;
  textReady: boolean;
  chunks: DeliveryChunk[];
  context?: { markdown: string; seed?: string };
  contextRecorded: boolean;
};
export class TelegramDeliveryError extends Error {
  constructor(
    readonly kind: 'failed' | 'unknown' | 'pending' | 'analysis',
    message = 'Telegram delivery did not complete',
  ) {
    super(message);
  }
}
export class TelegramRejected extends Error {}
export class TelegramImageExpired extends TelegramRejected {}
export function isKnownTelegramRejection(error: unknown) {
  return (
    error instanceof TelegramRejected ||
    (error instanceof GrammyError && error.error_code >= 400 && error.error_code < 500)
  );
}
export async function sendTelegramHtml(
  send: (text: string, html: boolean) => Promise<unknown>,
  html: string,
) {
  try {
    await send(html, true);
  } catch (error) {
    if (
      !(error instanceof GrammyError) ||
      error.error_code !== 400 ||
      !/parse entities|end of (?:the )?entity/i.test(error.description)
    )
      throw error;
    await send(html.replace(/<[^>]+>/g, ''), false);
  }
}
const active = new Map<string, Promise<TelegramDelivery>>();
let accepting = true;
const key = (operationId: string, chatId: number) => `${operationId}:${chatId}`;
function read(operationId: string, chatId: number): TelegramDelivery | null {
  const row = db
    .select()
    .from(telegramDeliveries)
    .where(eq(telegramDeliveries.key, key(operationId, chatId)))
    .get();
  return row ? (JSON.parse(row.payload) as TelegramDelivery) : null;
}
function save(value: TelegramDelivery, database = db) {
  database
    .insert(telegramDeliveries)
    .values({ key: key(value.operationId, value.chatId), payload: JSON.stringify(value) })
    .onConflictDoUpdate({ target: telegramDeliveries.key, set: { payload: JSON.stringify(value) } })
    .run();
}
export function getTelegramDelivery(operationId: string, chatId: number) {
  const value = read(operationId, chatId);
  if (
    value &&
    !active.has(key(operationId, chatId)) &&
    value.chunks.some((chunk) => chunk.state === 'sending')
  ) {
    value.chunks.forEach((chunk) => {
      if (chunk.state === 'sending') chunk.state = 'unknown';
    });
    save(value);
  }
  return value;
}
export function prepareTelegramDelivery(
  operationId: string,
  chatId: number,
  sessionId: string,
  questionDigest?: string,
) {
  const prior = getTelegramDelivery(operationId, chatId);
  if (prior) {
    if (questionDigest !== undefined && prior.questionDigest !== questionDigest)
      throw new Error('Telegram update ID reused');
    return prior;
  }
  const value: TelegramDelivery = {
    operationId,
    chatId,
    sessionId,
    questionDigest,
    textReady: false,
    chunks: [],
    contextRecorded: false,
  };
  save(value);
  return value;
}
export function setTelegramText(
  operationId: string,
  chatId: number,
  html: string,
  context?: TelegramDelivery['context'],
) {
  const value = getTelegramDelivery(operationId, chatId);
  if (!value) throw new Error('Telegram delivery is missing');
  const chunks = splitMessage(html).map((text, index): DeliveryChunk => ({
    id: `text:${index}`,
    kind: 'text',
    text,
    state: 'pending',
  }));
  if (value.textReady) {
    if (
      JSON.stringify(
        value.chunks.filter((chunk) => chunk.kind === 'text').map((chunk) => chunk.text),
      ) !== JSON.stringify(chunks.map((chunk) => chunk.text))
    )
      throw new Error('Telegram outcome changed');
    return;
  }
  value.chunks = [...chunks, ...value.chunks];
  value.textReady = true;
  value.context = context;
  save(value);
}
export function addTelegramImage(operationId: string, chatId: number, id: string, caption: string) {
  const value = getTelegramDelivery(operationId, chatId);
  if (!value || value.textReady) throw new Error('Reply image owner is closed');
  if (!value.chunks.some((chunk) => chunk.id === id)) {
    value.chunks.push({ id, kind: 'image', text: caption, state: 'pending' });
    save(value);
  }
}
export function expireTelegramImages(operationId: string, chatId: number, ids: string[]) {
  const value = getTelegramDelivery(operationId, chatId);
  if (!value) return;
  for (const chunk of value.chunks)
    if (ids.includes(chunk.id) && ['pending', 'failed'].includes(chunk.state))
      chunk.state = 'expired';
  save(value);
}
export function telegramDeliveryState(
  value: TelegramDelivery,
): 'sent' | 'failed' | 'unknown' | 'pending' {
  if (value.chunks.some((chunk) => chunk.state === 'unknown' || chunk.state === 'sending'))
    return 'unknown';
  if (value.chunks.some((chunk) => chunk.state === 'failed' || chunk.state === 'expired'))
    return 'failed';
  if (
    !value.textReady ||
    value.chunks.some((chunk) => chunk.state === 'pending') ||
    (value.context && !value.contextRecorded)
  )
    return 'pending';
  return 'sent';
}
export function deliverTelegram(
  operationId: string,
  chatId: number,
  send: (chunk: DeliveryChunk) => Promise<void>,
  onConfirmed?: (value: TelegramDelivery) => Promise<void>,
  retryFailed = false,
): Promise<TelegramDelivery> {
  const deliveryKey = key(operationId, chatId);
  const running = active.get(deliveryKey);
  if (running) return running;
  if (!accepting) return Promise.reject(new TelegramRejected('Telegram is stopping'));
  const value = getTelegramDelivery(operationId, chatId);
  if (!value || !value.textReady) return Promise.reject(new Error('Reply outcome is not ready'));
  const database = db;
  const check = () => {
    if (db !== database) throw new TelegramRejected('Retired delivery scope');
  };
  const work = Promise.resolve()
    .then(async () => {
      for (const chunk of value.chunks) {
        check();
        if (chunk.state === 'sent') continue;
        if (
          !accepting ||
          chunk.state === 'unknown' ||
          chunk.state === 'expired' ||
          (chunk.state === 'failed' && !retryFailed)
        )
          break;
        chunk.state = 'sending';
        save(value, database);
        try {
          await send(chunk);
          check();
          chunk.state = 'sent';
        } catch (error) {
          chunk.state =
            error instanceof TelegramImageExpired
              ? 'expired'
              : isKnownTelegramRejection(error)
                ? 'failed'
                : 'unknown';
          save(value, database);
          return value;
        }
        save(value, database);
      }
      if (
        value.context &&
        !value.contextRecorded &&
        value.chunks.every((chunk) => chunk.state === 'sent') &&
        onConfirmed
      ) {
        try {
          await onConfirmed(value);
          check();
          value.contextRecorded = true;
          save(value, database);
        } catch {
          /* Confirmed chunks stay sent; context can be retried without sending again. */
        }
      }
      return value;
    })
    .finally(() => {
      if (active.get(deliveryKey) === work) active.delete(deliveryKey);
    });
  active.set(deliveryKey, work);
  return work;
}
export function latestRetryableTelegramDelivery(chatId: number) {
  for (const row of db
    .select()
    .from(telegramDeliveries)
    .orderBy(desc(telegramDeliveries.id))
    .all()) {
    const value = JSON.parse(row.payload) as TelegramDelivery;
    if (value.chatId !== chatId || !value.textReady) continue;
    const current = getTelegramDelivery(value.operationId, chatId)!;
    if (
      telegramDeliveryState(current) !== 'unknown' &&
      !current.chunks.some((chunk) => chunk.state === 'expired') &&
      (current.chunks.some((chunk) => chunk.state === 'failed' || chunk.state === 'pending') ||
        (current.context && !current.contextRecorded))
    )
      return current;
  }
  return null;
}
export function pauseTelegramDeliveries() {
  accepting = false;
}
export function resumeTelegramDeliveries() {
  accepting = true;
}
export async function drainTelegramDeliveries() {
  await Promise.allSettled([...active.values()]);
}
