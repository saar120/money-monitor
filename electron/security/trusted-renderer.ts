const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * BrowserWindow privileges belong only to the exact loopback app origin.
 * Parsing first prevents authority confusion such as
 * `http://localhost:3000@attacker.example/`.
 */
export function isTrustedRendererURL(candidate: string, trustedOrigin: string): boolean {
  try {
    const parsed = new URL(candidate);
    return (
      parsed.origin === trustedOrigin &&
      parsed.username.length === 0 &&
      parsed.password.length === 0
    );
  } catch {
    return false;
  }
}

/** Returns a sanitized browser-safe URL, or null for local/privileged schemes. */
export function safeExternalURL(candidate: string): string | null {
  try {
    const parsed = new URL(candidate);
    if (!EXTERNAL_PROTOCOLS.has(parsed.protocol)) return null;
    if (parsed.username.length > 0 || parsed.password.length > 0) return null;
    return parsed.href;
  } catch {
    return null;
  }
}
