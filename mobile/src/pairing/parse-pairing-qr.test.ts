import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePairingQr } from './parse-pairing-qr.ts';

const valid = JSON.stringify({
  kind: 'money-monitor-pairing',
  version: 1,
  pairingId: 'pairing-session-01',
  nonce: 'NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN',
  serverId: '11111111-1111-4111-8111-111111111111',
  baseURL: 'https://money-monitor.tailnet.ts.net/money-monitor',
  protocolVersion: 1,
  expiresAt: '2026-09-07T18:00:00.000Z',
});

test('parses the Mac pairing payload without changing its mounted base URL', () => {
  assert.equal(
    parsePairingQr(valid).baseURL,
    'https://money-monitor.tailnet.ts.net/money-monitor',
  );
});

test('rejects non-HTTPS and credential-bearing server addresses', () => {
  assert.throws(() => parsePairingQr(valid.replace('https://', 'http://')), /private HTTPS/);
  assert.throws(
    () => parsePairingQr(valid.replace('https://', 'https://user:password@')),
    /private HTTPS/,
  );
});
