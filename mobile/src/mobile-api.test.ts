import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  completePairing,
  fetchHomeData,
  fetchTransactions,
  type PairingProgress,
} from './mobile-api.ts';

test('maps the server canonical bootstrap fixture into the live Home model', async () => {
  const fixture = readFileSync(
    new URL('../../src/mobile/fixtures/bootstrap/bootstrap-complete.json', import.meta.url),
    'utf8',
  );
  const originalFetch = globalThis.fetch;
  const overview = {
    data: {
      financialDate: '2026-03-08',
      currencyCode: 'ILS',
      cashflow: {
        spending: { value: '4560.30', currencyCode: 'ILS' },
        income: { value: '12000.00', currencyCode: 'ILS' },
        previousSpending: { value: '5000.00', currencyCode: 'ILS' },
        paceDelta: { value: '-439.70', currencyCode: 'ILS' },
        spendingVsIncomePercent: 38,
      },
      daily: [
        {
          day: 8,
          current: { value: '4560.30', currencyCode: 'ILS' },
          previous: { value: '5000.00', currencyCode: 'ILS' },
        },
      ],
      categories: [],
      merchants: [],
      budgets: [
        {
          name: 'Monthly',
          spent: { value: '4560.30', currencyCode: 'ILS' },
          limit: { value: '9000.00', currencyCode: 'ILS' },
          remaining: { value: '4439.70', currencyCode: 'ILS' },
          usedPercent: 50.7,
          elapsedPercent: 25.8,
          status: 'watch',
        },
      ],
      reviewCount: 2,
      sinceLastVisit: null,
      netWorth: {
        total: { value: '128430.27', currencyCode: 'ILS' },
        change: null,
        assets: null,
        liabilities: null,
        history: [],
      },
    },
    meta: { server: { id: '11111111-1111-4111-8111-111111111111' } },
  };
  globalThis.fetch = async (input) =>
    new Response(String(input).endsWith('/overview') ? JSON.stringify(overview) : fixture, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  try {
    const home = await fetchHomeData({
      serverId: '11111111-1111-4111-8111-111111111111',
      baseURL: 'https://money-monitor.tailnet.ts.net/money-monitor',
      token: 'T'.repeat(43),
    });
    assert.equal(home.spent, 4560.3);
    assert.equal(home.available, 4439.7);
    assert.equal(home.netWorth, 128430.27);
    assert.equal(home.freshness[0]?.account, 'Everyday Checking · 4321');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('completes the Mac approval flow and returns the device credential', async () => {
  const replies = [
    {
      status: 202,
      body: {
        data: {
          status: 'pending_approval',
          expiresAt: '2099-01-01T00:00:00.000Z',
          pollAfterSeconds: 1,
          claimantSecret: 'C'.repeat(43),
        },
      },
    },
    { status: 200, body: { data: { status: 'pending_approval' } } },
    { status: 200, body: { data: { status: 'approved' } } },
    {
      status: 201,
      body: {
        data: {
          status: 'claimed',
          credential: { token: 'T'.repeat(43) },
        },
      },
    },
  ];
  const paths: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    paths.push(new URL(String(input)).pathname);
    const reply = replies.shift();
    assert.ok(reply);
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const progress: PairingProgress[] = [];
    const credential = await completePairing(
      {
        kind: 'money-monitor-pairing',
        version: 1,
        pairingId: 'pairing-session-01',
        nonce: 'N'.repeat(43),
        serverId: '11111111-1111-4111-8111-111111111111',
        baseURL: 'https://money-monitor.tailnet.ts.net/money-monitor',
        protocolVersion: 1,
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
      'Saar’s iPhone',
      (value) => progress.push(value),
      undefined,
      0,
    );

    assert.deepEqual(progress, ['requesting', 'awaiting-approval', 'exchanging']);
    assert.deepEqual(paths, [
      '/money-monitor/api/mobile/v1/pairing/start',
      '/money-monitor/api/mobile/v1/pairing/status',
      '/money-monitor/api/mobile/v1/pairing/status',
      '/money-monitor/api/mobile/v1/pairing/exchange',
    ]);
    assert.equal(credential.token, 'T'.repeat(43));
    assert.equal(credential.baseURL, 'https://money-monitor.tailnet.ts.net/money-monitor');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('loads the full review inbox while keeping normal activity month-scoped', async () => {
  const paths: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    paths.push(String(input));
    return new Response(
      JSON.stringify({
        data: {
          financialDate: '2026-09-08',
          transactions: [],
          page: { hasMore: false },
        },
        meta: { server: { id: '11111111-1111-4111-8111-111111111111' } },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  const credential = {
    serverId: '11111111-1111-4111-8111-111111111111',
    baseURL: 'https://money-monitor.tailnet.ts.net/money-monitor',
    token: 'T'.repeat(43),
  };

  try {
    await fetchTransactions(credential, { filter: 'review' });
    await fetchTransactions(credential, {
      filter: 'all',
      startDate: '2026-09-01',
    });

    const review = new URL(paths[0]!);
    const activity = new URL(paths[1]!);
    assert.equal(review.searchParams.get('needsReview'), 'true');
    assert.equal(review.searchParams.has('startDate'), false);
    assert.equal(activity.searchParams.get('startDate'), '2026-09-01');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
