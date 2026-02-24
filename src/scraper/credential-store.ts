import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { config } from '../config.js';

const CREDENTIALS_FILE = 'data/credentials.enc';
const ALGORITHM = 'aes-256-gcm';

let cachedKey: Buffer | null = null;

function deriveKey(): Buffer {
  if (!cachedKey) {
    cachedKey = scryptSync(config.CREDENTIALS_MASTER_KEY, 'money-monitor-salt', 32);
  }
  return cachedKey;
}

function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(encoded: string): string {
  const key = deriveKey();
  const [ivHex, authTagHex, ciphertextHex] = encoded.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}

interface CredentialMap {
  [ref: string]: Record<string, string>;
}

function loadAll(): CredentialMap {
  mkdirSync('data', { recursive: true });
  if (!existsSync(CREDENTIALS_FILE)) return {};
  const raw = readFileSync(CREDENTIALS_FILE, 'utf8');
  return JSON.parse(decrypt(raw));
}

function saveAll(credentials: CredentialMap): void {
  mkdirSync('data', { recursive: true, mode: 0o700 });
  writeFileSync(CREDENTIALS_FILE, encrypt(JSON.stringify(credentials)), { mode: 0o600 });
  chmodSync(CREDENTIALS_FILE, 0o600);
}

export function getCredentials(ref: string): Record<string, string> | null {
  const all = loadAll();
  return all[ref] ?? null;
}

export function setCredentials(ref: string, creds: Record<string, string>): void {
  const all = loadAll();
  all[ref] = creds;
  saveAll(all);
}

export function deleteCredentials(ref: string): void {
  const all = loadAll();
  delete all[ref];
  saveAll(all);
}
