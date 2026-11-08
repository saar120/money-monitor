import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GrammyError } from 'grammy';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import type { DeliveryChunk } from './delivery.js';
import { telegramDeliveries } from '../db/schema.js';
let database: TestDb;
vi.mock('../db/connection.js', () => ({
  get db() {
    return database.db;
  },
}));
const delivery = await import('./delivery.js');
const images = await import('../ai/image-tools.js');
const owner = { replyId: 'reply-a', recipientId: 123, sessionId: 'session-a' };
beforeEach(() => {
  database = createTestDb();
  delivery.resumeTelegramDeliveries();
});
afterEach(async () => {
  await delivery.drainTelegramDeliveries();
  images.clearReplyImages();
  database.close();
  vi.useRealTimers();
});
function prepare(id = 'reply-a', chat = 123, text = 'first\nsecond') {
  delivery.prepareTelegramDelivery(id, chat, 'session-a');
  delivery.setTelegramText(id, chat, text);
}
describe('durable Telegram delivery', () => {
  it('coalesces a send, retains a known failed chunk, and retries only unconfirmed chunks explicitly', async () => {
    prepare();
    const value = delivery.getTelegramDelivery('reply-a', 123)!;
    value.chunks = [
      { id: 'one', kind: 'text', text: 'first', state: 'pending' },
      { id: 'two', kind: 'text', text: 'second', state: 'pending' },
    ];
    database.db
      .update(telegramDeliveries)
      .set({ payload: JSON.stringify(value) })
      .run();
    const sent: string[] = [];
    const send = vi.fn(async (chunk: DeliveryChunk) => {
      sent.push(chunk.id);
      if (chunk.id === 'two') throw new delivery.TelegramRejected('synthetic rejection');
    });
    const first = delivery.deliverTelegram('reply-a', 123, send);
    expect(delivery.deliverTelegram('reply-a', 123, send)).toBe(first);
    expect(delivery.telegramDeliveryState(await first)).toBe('failed');
    await delivery.deliverTelegram('reply-a', 123, send);
    expect(sent).toEqual(['one', 'two']);
    await delivery.deliverTelegram(
      'reply-a',
      123,
      async (chunk) => {
        sent.push(chunk.id);
      },
      undefined,
      true,
    );
    expect(sent).toEqual(['one', 'two', 'two']);
  });
  it('quarantines a lost response and a sending record left by restart without retrying either', async () => {
    prepare();
    const send = vi.fn().mockRejectedValue(new Error('synthetic response lost'));
    expect(
      delivery.telegramDeliveryState(await delivery.deliverTelegram('reply-a', 123, send)),
    ).toBe('unknown');
    await delivery.deliverTelegram('reply-a', 123, send, undefined, true);
    expect(send).toHaveBeenCalledOnce();
    const value = delivery.getTelegramDelivery('reply-a', 123)!;
    value.chunks[0].state = 'sending';
    database.db
      .update(telegramDeliveries)
      .set({ payload: JSON.stringify(value) })
      .run();
    expect(delivery.getTelegramDelivery('reply-a', 123)?.chunks[0].state).toBe('unknown');
    expect(delivery.latestRetryableTelegramDelivery(123)).toBeNull();
  });
  it('retries context persistence after confirmed delivery without sending the text again', async () => {
    delivery.prepareTelegramDelivery('alert', 123, 'original-session');
    delivery.setTelegramText('alert', 123, 'alert', { markdown: 'alert' });
    const send = vi.fn().mockResolvedValue(undefined);
    const context = vi
      .fn()
      .mockRejectedValueOnce(new Error('synthetic storage failure'))
      .mockResolvedValue(undefined);
    expect(
      delivery.telegramDeliveryState(await delivery.deliverTelegram('alert', 123, send, context)),
    ).toBe('pending');
    expect(
      delivery.telegramDeliveryState(await delivery.deliverTelegram('alert', 123, send, context)),
    ).toBe('sent');
    expect(send).toHaveBeenCalledOnce();
    expect(context).toHaveBeenLastCalledWith(
      expect.objectContaining({ sessionId: 'original-session' }),
    );
  });
  it('falls back to plain text only for a confirmed HTML parse rejection', async () => {
    const parse = new GrammyError(
      'synthetic',
      { ok: false, error_code: 400, description: "Bad Request: can't parse entities" },
      'sendMessage',
      {},
    );
    const send = vi.fn().mockRejectedValueOnce(parse).mockResolvedValue(undefined);
    await delivery.sendTelegramHtml(send, '<b>hello</b>');
    expect(send.mock.calls).toEqual([
      ['<b>hello</b>', true],
      ['hello', false],
    ]);
    send.mockReset().mockRejectedValue(new Error('response lost'));
    await expect(delivery.sendTelegramHtml(send, '<b>hello</b>')).rejects.toThrow('response lost');
    expect(send).toHaveBeenCalledOnce();
  });
});
describe('reply image ownership', () => {
  it('isolates concurrent recipients and retains a known failed image until retry or expiry', async () => {
    vi.useFakeTimers();
    const other = { replyId: 'reply-b', recipientId: 456, sessionId: 'session-b' };
    for (const current of [owner, other])
      delivery.prepareTelegramDelivery(current.replyId, current.recipientId, current.sessionId);
    images.queueReplyImage(owner, 'image:a', Buffer.from('a'), 'a');
    images.queueReplyImage(other, 'image:b', Buffer.from('b'), 'b');
    expect(() => images.getReplyImage(other, 'image:a')).toThrow('expired');
    expect(images.getReplyImage(owner, 'image:a').buffer.toString()).toBe('a');
    delivery.setTelegramText(owner.replyId, owner.recipientId, 'answer');
    await delivery.deliverTelegram(owner.replyId, owner.recipientId, async (chunk) => {
      if (chunk.kind === 'image') throw new delivery.TelegramRejected('synthetic photo rejection');
    });
    expect(images.getReplyImage(owner, 'image:a').buffer.toString()).toBe('a');
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1);
    expect(() => images.getReplyImage(owner, 'image:a')).toThrow('expired');
    expect(
      delivery.getTelegramDelivery(owner.replyId, owner.recipientId)?.chunks.at(-1)?.state,
    ).toBe('expired');
  });
  it('bounds image size, reply count and retained reply buffers', () => {
    delivery.prepareTelegramDelivery(owner.replyId, owner.recipientId, owner.sessionId);
    expect(() =>
      images.queueReplyImage(owner, 'large', Buffer.alloc(10 * 1024 * 1024 + 1), ''),
    ).toThrow('10 MB');
    for (let n = 0; n < 10; n++) images.queueReplyImage(owner, String(n), Buffer.from('a'), '');
    expect(() => images.queueReplyImage(owner, 'eleven', Buffer.from('a'), '')).toThrow('limit');
    for (let n = 0; n < 20; n++) {
      const current = { ...owner, replyId: `reply-${n}` };
      delivery.prepareTelegramDelivery(current.replyId, current.recipientId, current.sessionId);
      images.queueReplyImage(current, 'one', Buffer.from('b'), '');
    }
    expect(() => images.getReplyImage(owner, '0')).toThrow('expired');
  });
});
