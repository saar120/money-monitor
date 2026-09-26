import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMobileServer } from './mobile-server.js';
import type { MobileCredentialAuthenticator } from './mobile-auth.js';
import type { PublicMobileDevice } from './device-registry.js';
import {
  projectMobileRecurringPaymentDetail,
  projectMobileRecurringPayments,
} from './production-mobile-access.js';
import { createMobilePublicIdProjector } from './mobile-public-id.js';

const token = 'A'.repeat(43);
const publicAccountId = `account_${'b'.repeat(22)}`;
const device: PublicMobileDevice = {
  id: 'test-device',
  name: 'iPhone',
  capabilities: ['mobile.read'],
  protocolVersion: 1,
  tokenVersion: 1,
  createdAt: '2026-09-01T00:00:00.000Z',
  lastUsedAt: null,
  expiresAt: null,
  rotatedAt: null,
  revokedAt: null,
};

describe('mobile recurring payments route', () => {
  const servers: Array<ReturnType<typeof createMobileServer>> = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.shutdown()));
  });

  it('requires mobile.read and returns the bound result', async () => {
    const authenticate = vi.fn(() => ({ status: 'authenticated' as const, device }));
    const authenticator: MobileCredentialAuthenticator = { authenticate };
    const provide = vi.fn((asOfDate: string) => ({
      payments: [],
      suggestions: [],
      excluded: [],
      totals: [],
      asOfDate,
    }));
    const server = createMobileServer({
      recurringPayments: {
        authenticator,
        server: { id: '11111111-1111-4111-8111-111111111111', protocolVersion: 1 },
        provide,
      },
      clock: () => new Date('2026-09-26T09:00:00.000Z'),
      logger: false,
    });
    servers.push(server);

    const anonymous = await server.app.inject({
      method: 'GET',
      url: '/api/mobile/v1/recurring-payments',
    });
    expect(anonymous.statusCode).toBe(401);
    const response = await server.app.inject({
      method: 'GET',
      url: '/api/mobile/v1/recurring-payments',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(authenticate).toHaveBeenCalledWith(token, 'mobile.read');
    expect(provide).toHaveBeenCalledWith('2026-09-26');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toMatchObject({
      data: { payments: [], totals: [], asOfDate: '2026-09-26' },
      meta: { server: { id: '11111111-1111-4111-8111-111111111111' } },
    });
  });

  it('normalizes legacy shekel codes before the mobile contract sees them', () => {
    const payment = {
      accountId: 1,
      merchantKey: 'netflix',
      name: 'Netflix',
      accountName: 'Card',
      currencyCode: '₪',
      usualAmount: 50,
      monthlyCost: 50,
      annualCost: 600,
      frequency: 'monthly' as const,
      occurrences: 3,
      lastChargeDate: '2026-09-06',
      nextExpectedDate: '2026-10-06',
      confidence: 'likely' as const,
      kind: 'subscription' as const,
      source: 'automatic' as const,
    };
    const publicId = createMobilePublicIdProjector(
      'private-public-id-key-material-that-is-at-least-32-chars',
    );
    const result = projectMobileRecurringPayments(
      {
        asOfDate: '2026-09-26',
        classificationPending: false,
        payments: [payment],
        suggestions: [],
        excluded: [],
        totals: [
          { currencyCode: '₪', monthlyCost: 50, annualCost: 600 },
          { currencyCode: 'ILS', monthlyCost: 20, annualCost: 240 },
        ],
      },
      publicId,
    );
    expect(result.payments[0].currencyCode).toBe('ILS');
    expect(result.payments[0].accountId).toMatch(/^account_[A-Za-z0-9_-]{22}$/);
    expect(result.totals).toEqual([{ currencyCode: 'ILS', monthlyCost: 70, annualCost: 840 }]);
    const detail = projectMobileRecurringPaymentDetail(
      {
        payment,
        previousAmount: null,
        changedOnDate: null,
        transactions: [
          { id: 42, date: '2026-09-06', description: 'Netflix', amount: 50, inPattern: true },
        ],
      },
      publicId,
    );
    expect(detail.transactions[0].id).toMatch(/^transaction_[A-Za-z0-9_-]{22}$/);
    expect(detail.transactions[0].id).not.toBe('42');
  });

  it('validates authenticated review decisions on the paired Mac', async () => {
    const decide = vi.fn(
      (
        _input: { accountId: string; currencyCode: string; merchantKey: string; decision: string },
        asOfDate: string,
      ) => ({
        payments: [],
        suggestions: [],
        excluded: [],
        totals: [],
        asOfDate,
      }),
    );
    const server = createMobileServer({
      recurringPayments: {
        authenticator: { authenticate: () => ({ status: 'authenticated', device }) },
        server: { id: '11111111-1111-4111-8111-111111111111', protocolVersion: 1 },
        provide: () => ({
          payments: [],
          suggestions: [],
          excluded: [],
          totals: [],
          asOfDate: '2026-09-26',
        }),
        decide,
      },
      clock: () => new Date('2026-09-26T09:00:00.000Z'),
      logger: false,
    });
    servers.push(server);
    const url = '/api/mobile/v1/recurring-payments/decision';
    const payload = {
      accountId: publicAccountId,
      currencyCode: 'ILS',
      merchantKey: 'netflix',
      decision: 'exclude',
    };
    expect((await server.app.inject({ method: 'PUT', url, payload })).statusCode).toBe(401);
    const headers = { authorization: `Bearer ${token}` };
    expect(
      (
        await server.app.inject({
          method: 'PUT',
          url,
          headers,
          payload: { ...payload, decision: 'other' },
        })
      ).statusCode,
    ).toBe(400);
    const response = await server.app.inject({ method: 'PUT', url, headers, payload });
    expect(response.statusCode).toBe(200);
    expect(decide).toHaveBeenCalledWith(payload, '2026-09-26');
  });

  it('serves authenticated payment details with charge history', async () => {
    const merchantKey = 'a'.repeat(64);
    const detail = vi.fn(() => ({
      payment: {
        accountId: publicAccountId,
        merchantKey,
        name: 'Codex Subscription',
        accountName: 'Card',
        currencyCode: 'ILS',
        usualAmount: 100,
        monthlyCost: 100,
        annualCost: 1200,
        frequency: 'monthly',
        occurrences: 3,
        lastChargeDate: '2026-09-06',
        nextExpectedDate: '2026-10-06',
        confidence: 'likely',
        kind: 'subscription',
        source: 'manual',
      },
      previousAmount: 20,
      changedOnDate: '2026-09-06',
      transactions: [
        {
          id: `transaction_${'a'.repeat(22)}`,
          date: '2026-09-06',
          description: 'Codex Subscription',
          amount: 100,
          inPattern: true,
        },
      ],
    }));
    const server = createMobileServer({
      recurringPayments: {
        authenticator: { authenticate: () => ({ status: 'authenticated', device }) },
        server: { id: '11111111-1111-4111-8111-111111111111', protocolVersion: 1 },
        provide: () => ({
          payments: [],
          suggestions: [],
          excluded: [],
          totals: [],
          asOfDate: '2026-09-26',
        }),
        detail,
      },
      clock: () => new Date('2026-09-26T09:00:00.000Z'),
      logger: false,
    });
    servers.push(server);
    const url = `/api/mobile/v1/recurring-payments/detail?accountId=${publicAccountId}&currencyCode=ILS&merchantKey=${merchantKey}`;
    expect((await server.app.inject({ method: 'GET', url })).statusCode).toBe(401);
    const response = await server.app.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      previousAmount: 20,
      transactions: [{ inPattern: true }],
    });
    expect(detail).toHaveBeenCalledWith(
      { accountId: publicAccountId, currencyCode: 'ILS', merchantKey },
      '2026-09-26',
    );
  });
});
