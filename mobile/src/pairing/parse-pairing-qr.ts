export type PairingQrPayload = {
  kind: 'money-monitor-pairing';
  version: 1;
  pairingId: string;
  nonce: string;
  serverId: string;
  baseURL: string;
  protocolVersion: number;
  expiresAt: string;
};

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const NONCE = /^[A-Za-z0-9_-]{43}$/;

export function parsePairingQr(raw: string): PairingQrPayload {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('This is not a Money Monitor pairing code.');
  }

  if (!value || typeof value !== 'object') {
    throw new Error('This is not a Money Monitor pairing code.');
  }

  const candidate = value as Record<string, unknown>;
  if (
    candidate.kind !== 'money-monitor-pairing' ||
    candidate.version !== 1 ||
    typeof candidate.pairingId !== 'string' ||
    !SAFE_ID.test(candidate.pairingId) ||
    typeof candidate.nonce !== 'string' ||
    !NONCE.test(candidate.nonce) ||
    typeof candidate.serverId !== 'string' ||
    !SAFE_ID.test(candidate.serverId) ||
    !Number.isInteger(candidate.protocolVersion) ||
    (candidate.protocolVersion as number) < 1 ||
    typeof candidate.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(candidate.expiresAt)) ||
    typeof candidate.baseURL !== 'string'
  ) {
    throw new Error('This pairing code is invalid or unsupported.');
  }

  let baseURL: URL;
  try {
    baseURL = new URL(candidate.baseURL);
  } catch {
    throw new Error('This pairing code contains an invalid server address.');
  }
  if (
    baseURL.protocol !== 'https:' ||
    baseURL.username ||
    baseURL.password ||
    baseURL.search ||
    baseURL.hash
  ) {
    throw new Error('The Money Monitor server must use private HTTPS.');
  }

  return {
    kind: 'money-monitor-pairing',
    version: 1,
    pairingId: candidate.pairingId,
    nonce: candidate.nonce,
    serverId: candidate.serverId,
    baseURL: baseURL.toString().replace(/\/$/, ''),
    protocolVersion: candidate.protocolVersion as number,
    expiresAt: candidate.expiresAt,
  };
}
