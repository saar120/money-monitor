import { describe, expect, it } from 'vitest';
import { isTrustedRendererURL, safeExternalURL } from './trusted-renderer.js';

const APP_ORIGIN = 'http://localhost:43123';

describe('trusted renderer URL policy', () => {
  it('allows routes only on the exact parsed app origin', () => {
    expect(isTrustedRendererURL(`${APP_ORIGIN}/settings?tab=mobile#pair`, APP_ORIGIN)).toBe(true);
    expect(isTrustedRendererURL('http://localhost:43124/', APP_ORIGIN)).toBe(false);
    expect(isTrustedRendererURL('https://localhost:43123/', APP_ORIGIN)).toBe(false);
  });

  it('rejects authority confusion and credential-bearing URLs', () => {
    expect(isTrustedRendererURL('http://localhost:43123@attacker.example/', APP_ORIGIN)).toBe(
      false,
    );
    expect(isTrustedRendererURL('http://user@localhost:43123/', APP_ORIGIN)).toBe(false);
    expect(isTrustedRendererURL('not a URL', APP_ORIGIN)).toBe(false);
  });

  it('opens only credential-free HTTP(S) URLs externally', () => {
    expect(safeExternalURL('https://example.com/help?q=1')).toBe('https://example.com/help?q=1');
    expect(safeExternalURL('file:///tmp/private')).toBeNull();
    expect(safeExternalURL('javascript:alert(1)')).toBeNull();
    expect(safeExternalURL('https://user:secret@example.com/')).toBeNull();
  });
});
