import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMobileServer } from './mobile-server.js';
import type { PublicMobileDevice } from './device-registry.js';
import { MOBILE_REVIEW_RESOLVE_ROUTE, MOBILE_REVIEW_SKIP_ROUTE } from './review-command-routes.js';

const NOW = new Date('2026-07-18T12:00:00.000Z');
const TOKEN = 'A'.repeat(43);
const DEVICE: PublicMobileDevice = {
  id: 'device-1', name: 'iPhone', capabilities: ['mobile.review.write'], protocolVersion: 1,
  tokenVersion: 1, createdAt: NOW.toISOString(), lastUsedAt: null, expiresAt: null, rotatedAt: null, revokedAt: null,
};
const SERVER = { id: '11111111-1111-4111-8111-111111111111', protocolVersion: 1 as const };
const COMMAND = {
  idempotencyKey: 'command_key_1234567890',
  transactionId: 'transaction_abcdefghijklmnopqrstuv',
  categoryId: 'category_abcdefghijklmnopqrstuv',
  expectedNeedsReview: true,
};

describe('mobile review command route', () => {
  const servers: Array<ReturnType<typeof createMobileServer>> = [];
  afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.shutdown())); });

  it('requires the review-write capability and forwards the exact command once', async () => {
    const authenticate = vi.fn(() => ({ status: 'authenticated', device: DEVICE } as const));
    const resolve = vi.fn(() => ({ outcome: 'confirmed' as const, transactionId: COMMAND.transactionId, needsReview: false }));
    const server = createMobileServer({ reviewCommands: { authenticator: { authenticate }, server: SERVER, resolve, skip: vi.fn() }, clock: () => NOW, logger: false });
    servers.push(server);

    const response = await server.app.inject({ method: 'POST', url: MOBILE_REVIEW_RESOLVE_ROUTE, headers: { authorization: `Bearer ${TOKEN}` }, payload: COMMAND });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(authenticate).toHaveBeenCalledWith(TOKEN, 'mobile.review.write');
    expect(resolve).toHaveBeenCalledWith(COMMAND, expect.objectContaining({ generatedAt: NOW.toISOString() }), DEVICE);
    expect(response.json()).toMatchObject({ data: { outcome: 'confirmed', needsReview: false }, meta: { server: SERVER } });
  });

  it('rejects extra fields and does not invoke the command handler', async () => {
    const resolve = vi.fn();
    const server = createMobileServer({ reviewCommands: { authenticator: { authenticate: () => ({ status: 'authenticated', device: DEVICE } as const) }, server: SERVER, resolve, skip: vi.fn() }, clock: () => NOW, logger: false });
    servers.push(server);

    const response = await server.app.inject({ method: 'POST', url: MOBILE_REVIEW_RESOLVE_ROUTE, headers: { authorization: `Bearer ${TOKEN}` }, payload: { ...COMMAND, note: 'must not reach desktop' } });

    expect(response.statusCode).toBe(400);
    expect(resolve).not.toHaveBeenCalled();
    expect(response.body).not.toContain('must not reach desktop');
  });

  it('forwards an explicit skip command through the same review capability', async () => {
    const skip = vi.fn(() => ({ outcome: 'confirmed' as const, transactionId: COMMAND.transactionId, needsReview: false }));
    const server = createMobileServer({ reviewCommands: { authenticator: { authenticate: () => ({ status: 'authenticated', device: DEVICE } as const) }, server: SERVER, resolve: vi.fn(), skip }, clock: () => NOW, logger: false });
    servers.push(server);

    const response = await server.app.inject({ method: 'POST', url: MOBILE_REVIEW_SKIP_ROUTE, headers: { authorization: `Bearer ${TOKEN}` }, payload: { idempotencyKey: COMMAND.idempotencyKey, transactionId: COMMAND.transactionId, expectedNeedsReview: true } });

    expect(response.statusCode).toBe(200);
    expect(skip).toHaveBeenCalledOnce();
    expect(response.json()).toMatchObject({ data: { outcome: 'confirmed', needsReview: false } });
  });
});
