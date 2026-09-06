import { afterEach, describe, expect, it } from 'vitest';
import { createMobilePublicIdProjector } from '../../mobile/mobile-public-id.js';
import type { TransactionListQuery } from './client.js';
import {
  CANONICAL_TEST_PUBLIC_ID_KEY,
  CANONICAL_TEST_SERVER_ID,
  createCanonicalHarness,
  type CanonicalHarness,
} from './test-harness.js';

const NOW = new Date('2026-09-04T09:00:00.000Z');
const publicId = createMobilePublicIdProjector(CANONICAL_TEST_PUBLIC_ID_KEY);

function seed(server: CanonicalHarness) {
  server.sqlite.exec(`
    INSERT INTO members (id, name, is_active) VALUES (1, 'Saar', 1);
    INSERT INTO categories (id, name, label) VALUES (1, 'groceries', 'Groceries');
    INSERT INTO accounts (id, company_id, display_name, account_number, account_type, credentials_ref)
      VALUES
        (1, 'bank', 'Daily bank', '123456', 'bank', 'secret-ref'),
        (2, 'card', 'Main card', '9876', 'credit_card', 'secret-ref-2');
    INSERT INTO transactions
      (id, account_id, date, processed_date, original_amount, charged_amount, description,
       category, expense_owner_type, expense_owner_member_id, ignored, needs_review,
       review_reason, confidence, hash)
      VALUES
        (1, 1, '2026-09-01', '2026-09-01', -42.5, -42.5, 'רמי לוי Market',
         'groceries', 'member', 1, 0, 1, 'Low confidence', 0.6, 'tx-1'),
        (2, 2, '2026-09-02', '2026-09-03', -90, -90, 'Coffee House',
         NULL, 'shared', NULL, 0, 0, NULL, NULL, 'tx-2'),
        (3, 1, '2026-09-03', '2026-09-03', 500, 500, 'Salary',
         NULL, 'unassigned', NULL, 0, 0, NULL, NULL, 'tx-3'),
        (4, 1, '2026-09-04', '2026-09-04', -10, -10, 'Excluded fee',
         NULL, 'unassigned', NULL, 1, 0, NULL, NULL, 'tx-4');
  `);
}

describe('canonical transaction integration', () => {
  const servers: CanonicalHarness[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it('serves the identical generated contract to Mac and iPhone and removes both legacy reads', async () => {
    const server = await createCanonicalHarness({ clock: () => NOW });
    servers.push(server);
    seed(server);

    const query = {
      q: '  Ｍａｒｋｅｔ   ',
      accountType: 'bank',
      needsReview: true,
      sortBy: 'amount',
      sortOrder: 'asc',
    } satisfies TransactionListQuery;
    const [mac, iPhone] = await Promise.all([
      server.mac.listTransactions(query),
      server.iPhone.listTransactions(query),
    ]);

    expect(iPhone).toEqual(mac);
    expect(mac.data.transactions).toEqual([
      expect.objectContaining({
        id: publicId('transaction', 1),
        displayName: 'רמי לוי Market',
        amount: { value: '42.50', currencyCode: 'ILS' },
        category: expect.objectContaining({ name: 'groceries', label: 'Groceries' }),
        account: expect.objectContaining({
          displayName: 'Daily bank',
          identifierMask: '•••• 3456',
        }),
        owner: { id: publicId('member', 1), kind: 'member', displayName: 'Saar' },
        reviewReason: 'Low confidence',
        confidence: 0.6,
      }),
    ]);
    expect(JSON.stringify(mac)).not.toContain('secret-ref');
    expect(mac.meta.server).toEqual({ id: CANONICAL_TEST_SERVER_ID, protocolVersion: 1 });

    expect(server.macServer.app.hasRoute({ method: 'GET', url: '/api/transactions' })).toBe(false);
    expect(
      server.iPhoneServer.app.hasRoute({ method: 'GET', url: '/api/mobile/v1/transactions' }),
    ).toBe(false);
  });

  it('keeps a changing feed stable across cursor pages and binds cursors to filters', async () => {
    const server = await createCanonicalHarness({ clock: () => NOW });
    servers.push(server);
    seed(server);

    const first = await server.iPhone.listTransactions({ limit: 2 });
    expect(first.data.transactions.map((transaction) => transaction.displayName)).toEqual([
      'Salary',
      'Coffee House',
    ]);
    expect(first.data.page).toMatchObject({ total: 3, hasMore: true });

    server.sqlite.exec(`
      INSERT INTO transactions
        (id, account_id, date, processed_date, original_amount, charged_amount, description, hash)
      VALUES (5, 1, '2026-09-04', '2026-09-04', -1, -1, 'New arrival', 'tx-5');
    `);
    const second = await server.iPhone.listTransactions({
      limit: 2,
      cursor: first.data.page.nextCursor ?? undefined,
    });
    expect(second.data.transactions.map((transaction) => transaction.displayName)).toEqual([
      'רמי לוי Market',
    ]);
    expect(second.data.page).toEqual({ total: 3, hasMore: false, nextCursor: null });

    await expect(
      server.iPhone.listTransactions({
        limit: 2,
        q: 'Salary',
        cursor: first.data.page.nextCursor ?? undefined,
      }),
    ).rejects.toMatchObject({ code: 'validation_error', status: 400 });
  });

  it.each([
    ['date', 'asc'],
    ['date', 'desc'],
    ['processedDate', 'asc'],
    ['processedDate', 'desc'],
    ['amount', 'asc'],
    ['amount', 'desc'],
    ['description', 'asc'],
    ['description', 'desc'],
  ] as const)(
    'rejects a stale %s/%s cursor when a row changes across its boundary',
    async (sortBy, sortOrder) => {
      const server = await createCanonicalHarness({ clock: () => NOW });
      servers.push(server);
      seed(server);

      const first = await server.mac.listTransactions({ limit: 1, sortBy, sortOrder });
      server.sqlite.prepare("UPDATE transactions SET date = '2026-08-31' WHERE id = 2").run();

      await expect(
        server.mac.listTransactions({
          limit: 1,
          sortBy,
          sortOrder,
          cursor: first.data.page.nextCursor ?? undefined,
        }),
      ).rejects.toMatchObject({ code: 'validation_error', status: 400 });
    },
  );

  it('rejects a stale cursor when an update changes filter membership', async () => {
    const server = await createCanonicalHarness({ clock: () => NOW });
    servers.push(server);
    seed(server);

    const first = await server.mac.listTransactions({ limit: 1, needsReview: false });
    server.sqlite.prepare('UPDATE transactions SET needs_review = 1 WHERE id = 2').run();

    await expect(
      server.mac.listTransactions({
        limit: 1,
        needsReview: false,
        cursor: first.data.page.nextCursor ?? undefined,
      }),
    ).rejects.toMatchObject({ code: 'validation_error', status: 400 });
  });

  it('rejects private database account IDs at the shared contract boundary', async () => {
    const server = await createCanonicalHarness({ clock: () => NOW, startListeners: false });
    servers.push(server);
    seed(server);

    const response = await server.macServer.app.inject({
      method: 'GET',
      url: '/api/v1/transactions?accountId=1',
      headers: { authorization: `Bearer ${server.macToken}` },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'validation_error' } });

    const ownerResponse = await server.macServer.app.inject({
      method: 'GET',
      url: '/api/v1/transactions?ownerType=member&ownerMemberId=1',
      headers: { authorization: `Bearer ${server.macToken}` },
    });
    expect(ownerResponse.statusCode).toBe(400);

    const byOpaqueOwner = await server.macServer.app.inject({
      method: 'GET',
      url: `/api/v1/transactions?ownerType=member&ownerMemberId=${publicId('member', 1)}`,
      headers: { authorization: `Bearer ${server.macToken}` },
    });
    expect(byOpaqueOwner.statusCode).toBe(200);
    expect(
      byOpaqueOwner.json().data.transactions.map((transaction: { displayName: string }) =>
        transaction.displayName,
      ),
    ).toEqual(['רמי לוי Market']);
  });

  it('serves canonical detail and deterministic filter/sort combinations', async () => {
    const server = await createCanonicalHarness({ clock: () => NOW });
    servers.push(server);
    seed(server);

    const filtered = await server.mac.listTransactions({
      includeExcluded: true,
      direction: 'debit',
      minAmount: 40,
      maxAmount: 100,
      sortBy: 'description',
      sortOrder: 'asc',
    });
    expect(filtered.data.transactions.map((transaction) => transaction.displayName)).toEqual([
      'Coffee House',
      'רמי לוי Market',
    ]);
    expect(await server.mac.getTransaction(publicId('transaction', 2))).toEqual(
      expect.objectContaining({ displayName: 'Coffee House', status: 'posted' }),
    );
    expect((await server.mac.listTransactions({ q: '%' })).data.transactions).toEqual([]);
  });
});
