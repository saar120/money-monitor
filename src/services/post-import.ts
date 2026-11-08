import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { postImportJobs, alertEvaluations } from '../db/schema.js';
import { batchCategorize } from '../ai/categorization/index.js';
import { applyOwnership } from './ownership.js';
import {
  TelegramDeliveryError,
  getTelegramDelivery,
  telegramDeliveryState,
} from '../telegram/delivery.js';
import { runPostScrapeAlerts } from '../telegram/alerts.js';
import type { ScrapeResult } from '../scraper/scraper.service.js';

const active = new Map<number, Promise<void>>();
export function enqueuePostImport(
  source: string,
  ids: number[],
  results: ScrapeResult[] = [],
  database = db,
) {
  return database
    .insert(postImportJobs)
    .values({ source, transactionIds: JSON.stringify(ids), results: JSON.stringify(results) })
    .returning()
    .get().id;
}
export function runPostImport(id: number, signal?: AbortSignal): Promise<void> {
  const running = active.get(id);
  if (running) return running;
  const database = db;
  const job = database.select().from(postImportJobs).where(eq(postImportJobs.id, id)).get();
  if (!job || job.phase === 'finished' || job.phase === 'delivery-unknown')
    return Promise.resolve();
  const phase = (value: (typeof postImportJobs.$inferSelect)['phase']) =>
    database
      .update(postImportJobs)
      .set({ phase: value, updatedAt: new Date().toISOString() })
      .where(eq(postImportJobs.id, id))
      .run();
  const check = () => {
    signal?.throwIfAborted();
    if (db !== database) throw new Error('Retired database');
  };
  const promise = Promise.resolve().then(async () => {
    try {
      check();
      phase('classifying');
      const ids = JSON.parse(job.transactionIds) as number[];
      if (ids.length) await batchCategorize(ids.length, ids);
      check();
      phase('ownership');
      if (ids.length) applyOwnership({ ids });
      check();
      const results = JSON.parse(job.results) as ScrapeResult[];
      if (results.length) {
        phase('alerts');
        await runPostScrapeAlerts(results, `post-import:${id}`);
      }
      check();
      phase('finished');
    } catch (cause) {
      phase(
        cause instanceof TelegramDeliveryError && cause.kind === 'unknown'
          ? 'delivery-unknown'
          : 'attention-needed',
      );
      throw cause;
    } finally {
      if (active.get(id) === promise) active.delete(id);
    }
  });
  active.set(id, promise);
  void promise.catch(() => {});
  return promise;
}
export async function drainPostImports() {
  await Promise.allSettled([...active.values()]);
}
export function recoverPostImports() {
  // Only interrupted sends are uncertain; analysis and unsent chunks can recover safely.
  for (const job of db
    .select()
    .from(postImportJobs)
    .where(eq(postImportJobs.phase, 'alerts'))
    .all()) {
    const evaluation = db
      .select()
      .from(alertEvaluations)
      .where(eq(alertEvaluations.key, `post-import:${job.id}`))
      .get();
    const recipients = evaluation
      ? (JSON.parse(evaluation.payload) as { recipients: { chatId: number }[] }).recipients
      : [];
    const unknown = recipients.some(({ chatId }) => {
      const delivery = getTelegramDelivery(`post-import:${job.id}`, chatId);
      return delivery && telegramDeliveryState(delivery) === 'unknown';
    });
    db.update(postImportJobs)
      .set({ phase: unknown ? 'delivery-unknown' : 'attention-needed' })
      .where(eq(postImportJobs.id, job.id))
      .run();
  }
  const pending = db
    .select()
    .from(postImportJobs)
    .where(
      inArray(postImportJobs.phase, ['committed', 'classifying', 'ownership', 'attention-needed']),
    )
    .all();
  for (const job of pending) void runPostImport(job.id).catch(() => {});
}

/** A confirmed explicit delivery retry settles its import without repeating enrichment. */
export function reconcilePostImportAlert(operationId: string) {
  const match = /^post-import:(\d+)$/.exec(operationId);
  if (!match) return;
  const row = db.select().from(alertEvaluations).where(eq(alertEvaluations.key, operationId)).get();
  if (!row) return;
  const evaluation = JSON.parse(row.payload) as { state: string; recipients: { chatId: number }[] };
  if (
    evaluation.state !== 'ready' ||
    !evaluation.recipients.every(({ chatId }) => {
      const delivery = getTelegramDelivery(operationId, chatId);
      return delivery && telegramDeliveryState(delivery) === 'sent';
    })
  )
    return;
  db.update(postImportJobs)
    .set({ phase: 'finished', updatedAt: new Date().toISOString() })
    .where(eq(postImportJobs.id, Number(match[1])))
    .run();
}
