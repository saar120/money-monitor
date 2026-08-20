import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CanonicalApiClient } from './client.js';
import { CANONICAL_OPENAPI_DOCUMENT } from './openapi.js';
import { createCanonicalHarness, type CanonicalHarness } from './test-harness.js';
import { createServer } from '../../server.js';

const GENERATED_AT = new Date('2026-08-09T10:00:00.000Z');

describe('canonical /api/v1 black-box foundation', () => {
  const openHarnesses: CanonicalHarness[] = [];

  afterEach(async () => {
    await Promise.all(openHarnesses.splice(0).map((harness) => harness.close()));
  });

  async function harness(options: Parameters<typeof createCanonicalHarness>[0] = {}) {
    const result = await createCanonicalHarness({
      ...options,
      clock: () => GENERATED_AT,
    });
    openHarnesses.push(result);
    return result;
  }

  async function raw(
    baseUrl: string,
    path: string,
    init: RequestInit = {},
  ): Promise<{ status: number; body: unknown }> {
    const response = await fetch(`${baseUrl}${path}`, init);
    return { status: response.status, body: await response.json() };
  }

  it('exercises one reference request through both TCP listeners and generated clients', async () => {
    const server = await harness();

    const [macResource, iPhoneResource] = await Promise.all([
      server.mac.getReference(),
      server.iPhone.getReference(),
    ]);

    expect(macResource).toEqual(iPhoneResource);
    expect(macResource).toMatchObject({
      id: 1,
      amount: { value: '123.45', currencyCode: 'ILS' },
      resourceVersion: 1,
    });

    const macResponse = await raw(server.macBaseUrl, '/api/v1/reference?id=1', {
      headers: { authorization: 'Bearer mac-test-token' },
    });
    expect(macResponse.status).toBe(200);
    expect((macResponse.body as { meta: unknown }).meta).toMatchObject({
      apiVersion: '1',
      generatedAt: GENERATED_AT.toISOString(),
      source: 'mac-authoritative',
      calculationVersion: 'canonical-foundation-1',
      completeness: 'complete',
      estimated: false,
      resourceVersion: 1,
    });
  });

  it('uses one central policy matrix and redacts diagnostics from paired callers', async () => {
    const server = await harness();

    const [macDiagnostics, iPhoneDiagnostics, iPhonePairing, macPairing] = await Promise.all([
      raw(server.macBaseUrl, '/api/v1/diagnostics', {
        headers: { authorization: 'Bearer mac-test-token' },
      }),
      raw(server.iPhoneBaseUrl, '/api/v1/diagnostics', {
        headers: { authorization: `Bearer ${server.iPhoneToken}` },
      }),
      raw(server.iPhoneBaseUrl, '/api/v1/pairing/status', {
        headers: { authorization: `Bearer ${server.iPhoneToken}` },
      }),
      raw(server.macBaseUrl, '/api/v1/pairing/status', {
        headers: { authorization: 'Bearer mac-test-token' },
      }),
    ]);

    expect(macDiagnostics.status).toBe(200);
    expect((macDiagnostics.body as { data: unknown }).data).toEqual({
      listener: 'mac-local',
      capabilities: ['canonical-api'],
    });
    expect(iPhoneDiagnostics.status).toBe(403);
    expect(iPhoneDiagnostics.body).toMatchObject({ error: { code: 'mac_only' } });
    expect(JSON.stringify(iPhoneDiagnostics.body)).not.toContain('credentials');
    expect(iPhonePairing.status).toBe(200);
    expect((iPhonePairing.body as { data: unknown }).data).toEqual({
      paired: true,
      deviceId: server.iPhoneDeviceId,
    });
    expect(macPairing.status).toBe(403);
    expect(macPairing.body).toMatchObject({ error: { code: 'pairing_required' } });

    const unauthenticated = await raw(server.macBaseUrl, '/api/v1/reference');
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body).toMatchObject({
      error: { code: 'authentication_required' },
      meta: { apiVersion: '1' },
    });

    const invalidCredential = await raw(server.iPhoneBaseUrl, '/api/v1/reference', {
      headers: { authorization: `Bearer ${'X'.repeat(43)}` },
    });
    expect(invalidCredential.status).toBe(401);
    expect(invalidCredential.body).toMatchObject({
      error: { code: 'authentication_invalid' },
    });
  });

  it('keeps canonical auth ahead of the configured legacy API token hook', async () => {
    const sqlite = new Database(':memory:');
    const server = await createServer({
      sqlite,
      registerLegacyRoutes: false,
      startBackgroundServices: false,
      logger: false,
      clock: () => GENERATED_AT,
      seedCanonical: {
        id: 1,
        title: 'Default factory fixture',
        amount: { value: '123.45', currencyCode: 'ILS' },
        resourceVersion: 1,
        updatedAt: GENERATED_AT.toISOString(),
      },
    });

    try {
      await server.app.ready();

      const missing = await server.app.inject({
        method: 'GET',
        url: '/api/v1/reference',
      });
      expect(missing.statusCode).toBe(401);
      expect(JSON.parse(missing.body)).toMatchObject({
        error: { code: 'authentication_required' },
        meta: { apiVersion: '1' },
      });

      const invalid = await server.app.inject({
        method: 'GET',
        url: '/api/v1/reference',
        headers: { authorization: 'Bearer wrong-token' },
      });
      expect(invalid.statusCode).toBe(401);
      expect(JSON.parse(invalid.body)).toMatchObject({
        error: { code: 'authentication_invalid' },
      });

      const valid = await server.app.inject({
        method: 'GET',
        url: '/api/v1/reference',
        headers: { authorization: 'Bearer test-token' },
      });
      expect(valid.statusCode).toBe(200);
      expect(JSON.parse(valid.body)).toMatchObject({
        data: { id: 1, amount: { value: '123.45', currencyCode: 'ILS' } },
      });
    } finally {
      await server.shutdown();
      sqlite.close();
    }
  });

  it('shares Resource Versions and returns a coded conflict without leaking the resource', async () => {
    const server = await harness();

    const updated = await server.mac.updateReference(1, {
      expectedVersion: 1,
      title: 'Updated on Mac',
      amount: { value: '99.90', currencyCode: 'USD' },
    });
    expect(updated).toMatchObject({
      id: 1,
      title: 'Updated on Mac',
      amount: { value: '99.90', currencyCode: 'USD' },
      resourceVersion: 2,
    });
    expect(await server.iPhone.getReference()).toEqual(updated);

    const conflict = await raw(server.iPhoneBaseUrl, '/api/v1/reference/1', {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${server.iPhoneToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        expectedVersion: 1,
        title: 'Stale edit',
      }),
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({
      error: {
        code: 'resource_conflict',
        resourceId: 1,
        expectedVersion: 1,
        currentVersion: 2,
      },
    });
    expect((conflict.body as { error: unknown }).error).not.toHaveProperty('resource');
  });

  it('persists caller-scoped receipts, rejects reused keys, and returns targeted hints', async () => {
    const server = await harness();
    const request = { resourceId: 1, idempotencyKey: 'refresh-1', command: 'refresh' as const };

    const first = await server.iPhone.requestRefresh(request);
    const replay = await server.iPhone.requestRefresh(request);
    expect(first.meta.receipt).toEqual({ idempotencyKey: 'refresh-1', replayed: false });
    expect(replay.meta.receipt).toEqual({ idempotencyKey: 'refresh-1', replayed: true });
    expect(first.meta.refreshHints).toEqual([{ domain: 'reference', resourceIds: [1] }]);

    await expect(server.iPhone.requestRefresh({ ...request, resourceId: 2 })).rejects.toMatchObject(
      { code: 'idempotency_key_reused', status: 409 },
    );
  });

  it('resolves an unknown command by retrying the same receipt and fetching authority', async () => {
    const server = await harness({ allowUnknownOutcomeSimulation: true });

    const result = await server.iPhone.requestRefreshWithRecovery({
      resourceId: 1,
      idempotencyKey: 'unknown-refresh-1',
      command: 'refresh',
    });
    expect(result.status).toBe('unknown');
    if (result.status !== 'unknown') throw new Error('Expected unknown outcome');
    expect(result.resource).toMatchObject({ id: 1, resourceVersion: 1 });

    // A fresh generated client without the test fault proves that the receipt
    // was committed exactly once despite the first caller seeing 503 unknown.
    const recoveredClient = new CanonicalApiClient({
      baseUrl: server.iPhoneBaseUrl,
      token: server.iPhoneToken,
    });
    const replay = await recoveredClient.requestRefresh({
      resourceId: 1,
      idempotencyKey: 'unknown-refresh-1',
      command: 'refresh',
    });
    expect(replay.meta.receipt).toEqual({
      idempotencyKey: 'unknown-refresh-1',
      replayed: true,
    });
  });

  it('deletes with an expected version and returns a scoped refresh hint', async () => {
    const server = await harness();

    const deleted = await server.iPhone.deleteReference(1, 1);
    expect(deleted).toEqual({ deletedId: 1 });

    const response = await raw(server.macBaseUrl, '/api/v1/reference?id=1', {
      headers: { authorization: 'Bearer mac-test-token' },
    });
    expect(response.status).toBe(404);
    expect((response.body as { error: { code: string } }).error.code).toBe('resource_not_found');
  });

  it('retains deletion and mutation receipts across a file-backed listener restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'money-monitor-canonical-'));
    const databasePath = join(directory, 'canonical.sqlite');
    const firstSqlite = new Database(databasePath);
    const first = await createCanonicalHarness({
      sqlite: firstSqlite,
      clock: () => GENERATED_AT,
    });
    const token = first.iPhoneToken;
    await first.iPhone.requestRefresh({
      resourceId: 1,
      idempotencyKey: 'restart-receipt-1',
      command: 'refresh',
    });
    await first.iPhone.deleteReference(1, 1);
    await first.close();
    firstSqlite.close();

    const secondSqlite = new Database(databasePath);
    const second = await createCanonicalHarness({
      sqlite: secondSqlite,
      iPhoneToken: token,
      clock: () => GENERATED_AT,
    });
    try {
      await expect(second.iPhone.getReference()).rejects.toMatchObject({
        code: 'resource_not_found',
        status: 404,
      });
      const replay = await second.iPhone.requestRefresh({
        resourceId: 1,
        idempotencyKey: 'restart-receipt-1',
        command: 'refresh',
      });
      expect(replay.meta.receipt).toEqual({
        idempotencyKey: 'restart-receipt-1',
        replayed: true,
      });
    } finally {
      await second.close();
      secondSqlite.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('publishes all routes and schemas in the generated OpenAPI document', () => {
    expect(CANONICAL_OPENAPI_DOCUMENT.openapi).toBe('3.1.0');
    expect(Object.keys(CANONICAL_OPENAPI_DOCUMENT.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/reference',
        '/api/v1/reference/{id}',
        '/api/v1/reference/commands/refresh',
        '/api/v1/diagnostics',
        '/api/v1/pairing/status',
      ]),
    );
    expect(CANONICAL_OPENAPI_DOCUMENT.components.schemas).toEqual(
      expect.objectContaining({
        Money: expect.any(Object),
        ReferenceResponse: expect.any(Object),
        CanonicalErrorEnvelope: expect.any(Object),
      }),
    );
    const operationIds = Object.values(CANONICAL_OPENAPI_DOCUMENT.paths).flatMap((path) =>
      Object.values(path).map((operation) => (operation as { operationId: string }).operationId),
    );
    expect(new Set(operationIds).size).toBe(operationIds.length);
  });
});
