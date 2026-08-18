import { Agent, fetch as undiciFetch } from 'undici';

/**
 * OneZero's mobile API is protected by Cloudflare. The scraper package calls
 * global fetch in v6.8+, so route only tfd-bank.com requests through Undici
 * configured with the Android OkHttp 4.x TLS profile the mobile API expects.
 *
 * Mirrors https://github.com/galongin/Spent/commit/78f9dcb461187269cc5c08af6ce092de22c6cb6e
 * until the upstream scraper releases the same fix.
 */
const ANDROID_CIPHERS = [
  'TLS_AES_128_GCM_SHA256',
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'ECDHE-RSA-AES128-SHA',
  'ECDHE-RSA-AES256-SHA',
  'AES128-GCM-SHA256',
  'AES256-GCM-SHA384',
  'AES128-SHA',
  'AES256-SHA',
].join(':');

const ANDROID_SIGALGS = [
  'ecdsa_secp256r1_sha256',
  'rsa_pss_rsae_sha256',
  'rsa_pkcs1_sha256',
  'ecdsa_secp384r1_sha384',
  'rsa_pss_rsae_sha384',
  'rsa_pkcs1_sha384',
  'rsa_pss_rsae_sha512',
  'rsa_pkcs1_sha512',
].join(':');

const MOBILE_HEADERS: Record<string, string> = {
  'User-Agent': 'okhttp/4.10.0',
  'Accept-Encoding': 'gzip',
  Connection: 'Keep-Alive',
};

const PATCH_FLAG = Symbol.for('money-monitor.oneZeroFetchPatch');

function isTfdBankUrl(input: RequestInfo | URL): boolean {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  try {
    const host = new URL(raw).hostname;
    return host === 'tfd-bank.com' || host.endsWith('.tfd-bank.com');
  } catch {
    return false;
  }
}

/** Apply once, immediately before constructing the OneZero scraper. */
export function ensureOneZeroFetchPatch(): void {
  const global = globalThis as typeof globalThis & { [PATCH_FLAG]?: boolean };
  if (global[PATCH_FLAG]) return;
  global[PATCH_FLAG] = true;

  const mobileAgent = new Agent({
    connect: {
      ciphers: ANDROID_CIPHERS,
      sigalgs: ANDROID_SIGALGS,
      minVersion: 'TLSv1.2',
      maxVersion: 'TLSv1.3',
    },
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (!isTfdBankUrl(input)) return originalFetch(input, init);

    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return undiciFetch(url, {
      method: init?.method,
      body: init?.body as never,
      headers: {
        ...MOBILE_HEADERS,
        ...((init?.headers as Record<string, string>) ?? {}),
      },
      dispatcher: mobileAgent,
    }) as unknown as Promise<Response>;
  }) as typeof fetch;
}
