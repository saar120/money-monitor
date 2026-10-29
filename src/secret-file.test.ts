import { expect, it } from 'vitest';
import { sealSecretFile, openSecretFile } from './secret-file.js';
const key = 'synthetic-secret-file-test-master-key';
it('encrypts standalone credentials with fresh authenticated encryption', () => {
  const plaintext = '{"refresh":"synthetic-refresh"}';
  const sealed = sealSecretFile(plaintext, key, false);
  expect(sealed).not.toContain('synthetic-refresh');
  expect(sealSecretFile(plaintext, key, false)).not.toBe(sealed);
  expect(openSecretFile(sealed, key, false)).toBe(plaintext);
  expect(() => openSecretFile(sealed, 'different-key', false)).toThrow();
  const bytes = Buffer.from(sealed.slice('sealed:v1:'.length), 'base64');
  bytes[bytes.length - 1] ^= 1;
  expect(() => openSecretFile('sealed:v1:' + bytes.toString('base64'), key, false)).toThrow();
});
it('never falls back to plaintext for desktop writes', () => {
  expect(() => sealSecretFile('secret', key, true)).toThrow('no safe-storage');
});
