import { afterEach, describe, expect, it, vi } from 'vitest';
import { startDesktopServer } from './desktop-server-bind-policy.js';

describe('desktop server bind policy', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('forces Electron onto loopback even when HOST requests an external bind', async () => {
    vi.stubEnv('HOST', '0.0.0.0');
    const startServer = vi.fn(async () => 43_123);

    await expect(startDesktopServer(startServer)).resolves.toBe(43_123);

    expect(startServer).toHaveBeenCalledOnce();
    expect(startServer).toHaveBeenCalledWith({ port: 0, host: '127.0.0.1' });
  });
});
