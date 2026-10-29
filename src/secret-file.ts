import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { decryptSecret, encryptSecret, isSafeStorageAvailable } from './safe-storage.js';

const PREFIX = 'sealed:v1:';

/** Desktop uses the OS keyring; standalone uses its externally supplied master key. */
export function sealSecretFile(value: string, masterKey: string, desktop: boolean): string {
  if (desktop) return encryptSecret(value);
  if (!masterKey || masterKey.length < 32)
    throw new Error('A master key of at least 32 characters is required');
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', scryptSync(masterKey, salt, 32), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([salt, iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

export function openSecretFile(value: string, masterKey: string, desktop: boolean): string {
  if (value.startsWith('enc:')) return decryptSecret(value);
  if (desktop && !isSafeStorageAvailable()) throw new Error('Secure storage is required');
  if (!value.startsWith(PREFIX)) return value; // Legacy JSON is migrated by the caller.
  const bytes = Buffer.from(value.slice(PREFIX.length), 'base64');
  if (bytes.length < 44) throw new Error('Invalid encrypted credential file');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    scryptSync(masterKey, bytes.subarray(0, 16), 32),
    bytes.subarray(16, 28),
  );
  decipher.setAuthTag(bytes.subarray(28, 44));
  return Buffer.concat([decipher.update(bytes.subarray(44)), decipher.final()]).toString('utf8');
}
