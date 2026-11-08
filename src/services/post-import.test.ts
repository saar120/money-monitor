import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { postImportJobs, alertEvaluations } from '../db/schema.js';
let database: TestDb;
const { classify, ownership, alerts } = vi.hoisted(() => ({
  classify: vi.fn(),
  ownership: vi.fn(),
  alerts: vi.fn(),
}));
vi.mock('../db/connection.js', () => ({
  get db() {
    return database.db;
  },
}));
vi.mock('../ai/categorization/index.js', () => ({ batchCategorize: classify }));
vi.mock('./ownership.js', () => ({ applyOwnership: ownership }));
vi.mock('../telegram/alerts.js', () => ({ runPostScrapeAlerts: alerts }));
const { enqueuePostImport, runPostImport, recoverPostImports, drainPostImports } =
  await import('./post-import.js');
describe('durable post-import work', () => {
  beforeEach(() => {
    database = createTestDb();
    classify.mockReset().mockResolvedValue({ categorized: 1 });
    ownership.mockReset();
    alerts.mockReset();
  });
  afterEach(() => database.close());
  it('recovers committed enrichment and quarantines an interrupted external-send phase', async () => {
    enqueuePostImport('synthetic-import', [1]);
    database.db
      .insert(postImportJobs)
      .values({ source: 'synthetic-interrupted-send', transactionIds: '[]', phase: 'alerts' })
      .run();
    const { prepareTelegramDelivery, setTelegramText } = await import('../telegram/delivery.js');
    const { telegramDeliveries } = await import('../db/schema.js');
    database.db
      .insert(alertEvaluations)
      .values({
        key: 'post-import:2',
        payload: JSON.stringify({ state: 'ready', recipients: [{ chatId: 123 }] }),
      })
      .run();
    prepareTelegramDelivery('post-import:2', 123, 'session');
    setTelegramText('post-import:2', 123, 'synthetic alert');
    const row = database.db.select().from(telegramDeliveries).get()!;
    const value = JSON.parse(row.payload);
    value.chunks[0].state = 'sending';
    database.db
      .update(telegramDeliveries)
      .set({ payload: JSON.stringify(value) })
      .run();
    recoverPostImports();
    await drainPostImports();
    expect(
      database.db
        .select()
        .from(postImportJobs)
        .all()
        .map((job) => job.phase),
    ).toEqual(['finished', 'delivery-unknown']);
    expect(classify).toHaveBeenCalledWith(1, [1]);
    expect(ownership).toHaveBeenCalledWith({ ids: [1] });
    expect(alerts).not.toHaveBeenCalled();
  });
  it('does not advance ownership or delivery after cancellation during classification', async () => {
    let finish!: () => void;
    classify.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const id = enqueuePostImport('synthetic-import', [1]);
    const controller = new AbortController();
    const running = runPostImport(id, controller.signal);
    await Promise.resolve();
    controller.abort();
    finish();
    await expect(running).rejects.toBeDefined();
    expect(database.db.select().from(postImportJobs).get()?.phase).toBe('attention-needed');
    expect(ownership).not.toHaveBeenCalled();
    expect(alerts).not.toHaveBeenCalled();
  });
});

for (const [kind, phase] of [
  ['analysis', 'attention-needed'],
  ['failed', 'attention-needed'],
  ['unknown', 'delivery-unknown'],
] as const) {
  it(`keeps ${kind} alert outcomes visible as ${phase}`, async () => {
    database = createTestDb();
    const { TelegramDeliveryError } = await import('../telegram/delivery.js');
    alerts.mockRejectedValueOnce(new TelegramDeliveryError(kind));
    const id = enqueuePostImport(
      'synthetic-alert',
      [],
      [{ accountId: 1, success: true, transactionsFound: 0, transactionsNew: 0, durationMs: 1 }],
    );
    await expect(runPostImport(id)).rejects.toBeDefined();
    expect(alerts).toHaveBeenLastCalledWith(expect.any(Array), `post-import:${id}`);
    expect(database.db.select().from(postImportJobs).get()?.phase).toBe(phase);
    database.close();
  });
}
