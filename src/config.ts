import path from 'node:path';
import crypto from 'node:crypto';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getEnv(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

export function getConfig() {
  return {
    port: parseInt(getEnv('PORT', '3000'), 10),
    anthropicApiKey: requireEnv('ANTHROPIC_API_KEY'),
    encryptionKey: requireEnv('ENCRYPTION_KEY'),
    databasePath: getEnv(
      'DATABASE_PATH',
      path.join(process.cwd(), 'data', 'money-monitor.db'),
    ),
  };
}

export type Config = ReturnType<typeof getConfig>;

// --- Credential encryption utilities ---

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

export function encrypt(plaintext: string, hexKey: string): string {
  const key = Buffer.from(hexKey, 'hex');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  // Store as iv:authTag:ciphertext (all hex)
  return [
    iv.toString('hex'),
    authTag.toString('hex'),
    encrypted.toString('hex'),
  ].join(':');
}

export function decrypt(encoded: string, hexKey: string): string {
  const key = Buffer.from(hexKey, 'hex');
  const [ivHex, authTagHex, ciphertextHex] = encoded.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}
