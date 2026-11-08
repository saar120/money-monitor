import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { assets, holdings, mutationReceipts } from '../db/schema.js';
let database: TestDb;
vi.mock('../db/connection.js', () => ({
  get db() {
    return database.db;
  },
  get sqlite() {
    return database.sqlite;
  },
}));
vi.mock('./exchange-rates.js', async (original) => ({
  ...(await original<typeof import('./exchange-rates.js')>()),
  getExchangeRates: async () => ({ rates: { ILS: 1, USD: 3.5 }, stale: false, fetchedAt: '' }),
}));
const { commandHoldingPrices } = await import('./assets.js');
describe('bulk holding commands', () => {
  beforeEach(() => {
    database = createTestDb();
  });
  afterEach(() => database.close());
  it('validates every version before writing and replays one accepted portfolio snapshot', async () => {
    const asset = database.db
      .insert(assets)
      .values({ name: 'Synthetic portfolio', type: 'brokerage' })
      .returning()
      .get();
    const rows = ['One', 'Two'].map((name) =>
      database.db
        .insert(holdings)
        .values({
          assetId: asset.id,
          name,
          type: 'stock',
          currency: 'USD',
          quantity: 1,
          lastPrice: 10,
        })
        .returning()
        .get(),
    );
    const command = {
      commandId: randomUUID(),
      updates: rows.map((row) => ({ id: row.id, expectedVersion: 1, quantity: 2, lastPrice: 20 })),
    };
    database.db.update(holdings).set({ lastPrice: 11 }).where(eq(holdings.id, rows[1].id)).run();
    await expect(commandHoldingPrices(asset.id, command)).rejects.toMatchObject({
      code: 'mutation_conflict',
    });
    expect(
      database.db.select().from(holdings).where(eq(holdings.id, rows[0].id)).get(),
    ).toMatchObject({ quantity: 1, lastPrice: 10, resourceVersion: 1 });
    expect(database.db.select().from(mutationReceipts).all()).toHaveLength(0);
    command.updates[1].expectedVersion = 2;
    const accepted = await commandHoldingPrices(asset.id, command);
    expect(accepted.asset.holdings.map((row) => row.resourceVersion)).toEqual([2, 3]);
    expect(accepted.asset.totalValueIls).toBe(280);
    expect(await commandHoldingPrices(asset.id, command)).toEqual(accepted);
    expect(database.db.select().from(mutationReceipts).all()).toHaveLength(1);
    await expect(
      commandHoldingPrices(asset.id, {
        ...command,
        updates: [{ ...command.updates[0], quantity: 3 }],
      }),
    ).rejects.toMatchObject({ code: 'command_id_reused' });
  });
});
