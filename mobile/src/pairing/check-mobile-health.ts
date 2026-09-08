import type { PairingQrPayload } from './parse-pairing-qr';

export type MobileHealthResult =
  | { reachable: true; endpoint: string; generatedAt: string }
  | { reachable: false; endpoint: string; message: string };

export async function checkMobileHealth(
  pairing: PairingQrPayload,
  timeoutMs = 8000,
): Promise<MobileHealthResult> {
  const endpoint = `${pairing.baseURL}/api/mobile/v1/health`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const body: unknown = await response.json();
    if (
      !response.ok ||
      !body ||
      typeof body !== 'object' ||
      !('data' in body) ||
      !body.data ||
      typeof body.data !== 'object' ||
      !('status' in body.data) ||
      body.data.status !== 'ok' ||
      !('meta' in body) ||
      !body.meta ||
      typeof body.meta !== 'object' ||
      !('generatedAt' in body.meta) ||
      typeof body.meta.generatedAt !== 'string'
    ) {
      return { reachable: false, endpoint, message: `Unexpected response (${response.status}).` };
    }
    return { reachable: true, endpoint, generatedAt: body.meta.generatedAt };
  } catch (error) {
    return {
      reachable: false,
      endpoint,
      message:
        error instanceof Error && error.name === 'AbortError'
          ? 'The Mac did not respond in time.'
          : 'The Mac is unreachable. Check that both devices are on the same Tailnet.',
    };
  } finally {
    clearTimeout(timeout);
  }
}
