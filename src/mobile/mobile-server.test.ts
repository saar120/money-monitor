import { afterEach, describe, expect, it } from 'vitest';
import { createMobileServer, MOBILE_SERVER_HOST } from './mobile-server.js';

const GENERATED_AT = new Date('2026-07-15T09:30:00.000Z');

describe('mobile-only server', () => {
  const openServers: Array<ReturnType<typeof createMobileServer>> = [];

  function makeServer() {
    const server = createMobileServer({
      clock: () => GENERATED_AT,
      logger: false,
    });
    openServers.push(server);
    return server;
  }

  afterEach(async () => {
    await Promise.all(openServers.splice(0).map((server) => server.shutdown()));
  });

  it('returns the versioned health envelope', async () => {
    const { app } = makeServer();

    const response = await app.inject({
      method: 'GET',
      url: '/api/mobile/v1/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.json()).toEqual({
      data: { status: 'ok' },
      meta: {
        apiVersion: '1',
        generatedAt: GENERATED_AT.toISOString(),
        source: 'live',
      },
    });
  });

  it('marks successful and error responses as non-cacheable', async () => {
    const { app } = makeServer();

    const [health, missing] = await Promise.all([
      app.inject({ method: 'GET', url: '/api/mobile/v1/health' }),
      app.inject({ method: 'GET', url: '/api/mobile/v1/not-a-route' }),
    ]);

    expect(health.statusCode).toBe(200);
    expect(missing.statusCode).toBe(404);
    expect(health.headers['cache-control']).toBe('no-store');
    expect(missing.headers['cache-control']).toBe('no-store');
  });

  it.each([
    ['desktop health', '/api/health'],
    ['accounts', '/api/accounts'],
    ['settings', '/api/settings'],
    ['scraping', '/api/scrape'],
    ['Advisor', '/api/ai/chat'],
    ['dashboard root', '/'],
    ['dashboard asset', '/assets/index.js'],
  ])('does not expose the %s route', async (_name, url) => {
    const { app } = makeServer();

    const response = await app.inject({ method: 'GET', url });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: {
        code: 'route_not_found',
        message: 'The requested mobile route does not exist.',
      },
      meta: {
        apiVersion: '1',
      },
    });
    expect(response.json().meta.requestId).toEqual(expect.any(String));
  });

  it('does not implicitly expose HEAD or mutation methods for health', async () => {
    const { app } = makeServer();

    const [head, post] = await Promise.all([
      app.inject({ method: 'HEAD', url: '/api/mobile/v1/health' }),
      app.inject({ method: 'POST', url: '/api/mobile/v1/health' }),
    ]);

    expect(head.statusCode).toBe(404);
    expect(post.statusCode).toBe(404);
  });

  it('binds to an ephemeral loopback port by default', async () => {
    const { app, start } = makeServer();

    const port = await start();
    const address = app.server.address();

    expect(port).toBeGreaterThan(0);
    expect(address).toMatchObject({ address: MOBILE_SERVER_HOST, port });
  });

  it('rejects a non-loopback host even from an untyped runtime caller', async () => {
    const { app, start } = makeServer();

    await expect(start({ host: '0.0.0.0' as typeof MOBILE_SERVER_HOST })).rejects.toThrow(
      `Mobile server may bind only to ${MOBILE_SERVER_HOST}`,
    );
    expect(app.server.listening).toBe(false);
  });
});
