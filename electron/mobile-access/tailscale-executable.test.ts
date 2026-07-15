import { describe, expect, it, vi } from 'vitest';
import { resolveTailscaleExecutable } from './tailscale-executable.js';

describe('resolveTailscaleExecutable', () => {
  it('prefers an executable from an absolute PATH entry', () => {
    const isExecutable = vi.fn((path: string) => path === '/custom/bin/tailscale');

    expect(
      resolveTailscaleExecutable({
        platform: 'darwin',
        pathValue: '/custom/bin:/usr/bin',
        isExecutable,
      }),
    ).toBe('/custom/bin/tailscale');
  });

  it('uses a standard macOS location when Finder PATH omits it', () => {
    const isExecutable = vi.fn((path: string) => path === '/usr/local/bin/tailscale');

    expect(
      resolveTailscaleExecutable({
        platform: 'darwin',
        pathValue: '/usr/bin:/bin',
        isExecutable,
      }),
    ).toBe('/usr/local/bin/tailscale');
  });

  it('prefers the real macOS app executable over a launcher script', () => {
    const isExecutable = vi.fn((path: string) =>
      ['/usr/local/bin/tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'].includes(
        path,
      ),
    );

    expect(
      resolveTailscaleExecutable({
        platform: 'darwin',
        pathValue: '/usr/local/bin:/usr/bin',
        isExecutable,
      }),
    ).toBe('/Applications/Tailscale.app/Contents/MacOS/Tailscale');
  });

  it('ignores relative PATH entries instead of resolving through the app directory', () => {
    const isExecutable = vi.fn(() => false);

    expect(
      resolveTailscaleExecutable({
        platform: 'darwin',
        pathValue: '.:bin',
        isExecutable,
      }),
    ).toBe('tailscale');
    expect(isExecutable).not.toHaveBeenCalledWith('tailscale');
  });

  it('falls back to the platform command name when no known file is executable', () => {
    expect(
      resolveTailscaleExecutable({
        platform: 'win32',
        pathValue: '',
        isExecutable: () => false,
      }),
    ).toBe('tailscale.exe');
  });
});
