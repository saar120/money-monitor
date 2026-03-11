/**
 * Pluggable safe storage for encrypting secrets at rest.
 *
 * In Electron mode the main process registers an implementation backed by
 * Electron's `safeStorage` API (OS keychain).  In standalone mode no
 * implementation is registered and values pass through as plaintext.
 *
 * Encrypted values are prefixed with "enc:" so loaders can distinguish them
 * from legacy plaintext entries and migrate transparently.
 */

const ENC_PREFIX = 'enc:';

let _encrypt: ((plaintext: string) => Buffer) | null = null;
let _decrypt: ((encrypted: Buffer) => string) | null = null;

/** Register the platform encrypt/decrypt primitives (called once from Electron main). */
export function registerSafeStorage(impl: {
  encrypt: (plaintext: string) => Buffer;
  decrypt: (encrypted: Buffer) => string;
}): void {
  _encrypt = impl.encrypt;
  _decrypt = impl.decrypt;
}

/** Whether a real safe-storage backend has been registered. */
export function isSafeStorageAvailable(): boolean {
  return _encrypt !== null && _decrypt !== null;
}

/** Encrypt a plaintext secret.  Returns an `enc:<base64>` string. */
export function encryptSecret(plaintext: string): string {
  if (!_encrypt) return plaintext;
  const buf = _encrypt(plaintext);
  return ENC_PREFIX + buf.toString('base64');
}

/**
 * Decrypt a value.  If it carries the `enc:` prefix it is decrypted via the
 * registered backend; otherwise it is returned as-is (legacy plaintext).
 */
export function decryptSecret(value: string): string {
  if (!value.startsWith(ENC_PREFIX)) return value;
  if (!_decrypt) {
    throw new Error('Cannot decrypt secret: no safe-storage backend registered');
  }
  const buf = Buffer.from(value.slice(ENC_PREFIX.length), 'base64');
  return _decrypt(buf);
}

/** Check whether a value is already encrypted (carries the enc: prefix). */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENC_PREFIX);
}
