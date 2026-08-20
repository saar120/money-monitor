import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { MobileTransactionQuery } from './transaction-contract.js';

const CURSOR_PREFIX = 'cursor_v1_' as const;
const CURSOR_AAD = Buffer.from('money-monitor/mobile-transactions/cursor/v1', 'utf8');
const CURSOR_KEY_CONTEXT = 'money-monitor/mobile-transactions/cursor-key/v1';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export interface MobileTransactionCursorPosition {
  date: string;
  id: number;
  snapshotCeilingId: number;
}

export interface MobileTransactionCursorBinding {
  filterFingerprint: string;
  financialDate: string;
}

interface CursorPlaintext extends MobileTransactionCursorPosition, MobileTransactionCursorBinding {
  version: 1;
}

export class MobileTransactionCursorError extends Error {
  constructor() {
    super('Invalid mobile transaction cursor');
    this.name = 'MobileTransactionCursorError';
  }
}

function validFinancialDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validFingerprint(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function fingerprintsEqual(left: string, right: string): boolean {
  if (!validFingerprint(left) || !validFingerprint(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function derivedCursorKey(secret: string): Buffer {
  if (secret.length < 32) {
    throw new Error('Mobile cursor secret must contain at least 32 characters');
  }
  return createHash('sha256')
    .update(CURSOR_KEY_CONTEXT, 'utf8')
    .update('\0', 'utf8')
    .update(secret, 'utf8')
    .digest();
}

export function canonicalTransactionFilterFingerprint(query: MobileTransactionQuery): string {
  const canonical = JSON.stringify({
    q: query.q ?? null,
    startDate: query.startDate ?? null,
    endDate: query.endDate ?? null,
    direction: query.direction ?? null,
    status: query.status ?? null,
    needsReview: query.needsReview ?? null,
    includeExcluded: query.includeExcluded,
    accountId: query.accountId ?? null,
    sort: 'date_desc_id_desc',
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function createMobileTransactionCursorCodec(
  secret: string,
  options: { randomBytes?: (size: number) => Buffer } = {},
) {
  const key = derivedCursorKey(secret);
  const makeRandomBytes = options.randomBytes ?? randomBytes;

  function encode(
    position: Readonly<MobileTransactionCursorPosition>,
    binding: Readonly<MobileTransactionCursorBinding>,
  ): string {
    if (
      !validFinancialDate(position.date) ||
      !Number.isSafeInteger(position.id) ||
      position.id <= 0 ||
      !Number.isSafeInteger(position.snapshotCeilingId) ||
      position.snapshotCeilingId < position.id ||
      !validFinancialDate(binding.financialDate) ||
      !validFingerprint(binding.filterFingerprint)
    ) {
      throw new MobileTransactionCursorError();
    }

    const iv = makeRandomBytes(IV_BYTES);
    if (iv.length !== IV_BYTES) throw new MobileTransactionCursorError();
    const plaintext: CursorPlaintext = {
      version: 1,
      date: position.date,
      id: position.id,
      snapshotCeilingId: position.snapshotCeilingId,
      filterFingerprint: binding.filterFingerprint,
      financialDate: binding.financialDate,
    };
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(CURSOR_AAD);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(plaintext), 'utf8'),
      cipher.final(),
    ]);
    const encoded = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
    const cursor = `${CURSOR_PREFIX}${encoded}`;
    if (cursor.length > 512) throw new MobileTransactionCursorError();
    return cursor;
  }

  function decode(
    cursor: string,
    binding: Readonly<MobileTransactionCursorBinding>,
  ): MobileTransactionCursorPosition {
    try {
      if (
        cursor.length > 512 ||
        !cursor.startsWith(CURSOR_PREFIX) ||
        !/^cursor_v1_[A-Za-z0-9_-]+$/.test(cursor) ||
        !validFinancialDate(binding.financialDate) ||
        !validFingerprint(binding.filterFingerprint)
      ) {
        throw new MobileTransactionCursorError();
      }

      const encoded = cursor.slice(CURSOR_PREFIX.length);
      const payload = Buffer.from(encoded, 'base64url');
      if (
        payload.toString('base64url') !== encoded ||
        payload.length <= IV_BYTES + AUTH_TAG_BYTES
      ) {
        throw new MobileTransactionCursorError();
      }
      const iv = payload.subarray(0, IV_BYTES);
      const authTag = payload.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
      const ciphertext = payload.subarray(IV_BYTES + AUTH_TAG_BYTES);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(CURSOR_AAD);
      decipher.setAuthTag(authTag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
        'utf8',
      );
      const value = JSON.parse(plaintext) as Partial<CursorPlaintext>;
      if (
        value.version !== 1 ||
        !validFinancialDate(value.date) ||
        !Number.isSafeInteger(value.id) ||
        (value.id ?? 0) <= 0 ||
        !Number.isSafeInteger(value.snapshotCeilingId) ||
        (value.snapshotCeilingId ?? 0) < (value.id ?? 0) ||
        !validFingerprint(value.filterFingerprint) ||
        !validFinancialDate(value.financialDate) ||
        value.financialDate !== binding.financialDate ||
        !fingerprintsEqual(value.filterFingerprint, binding.filterFingerprint) ||
        Object.keys(value).sort().join(',') !==
          ['date', 'filterFingerprint', 'financialDate', 'id', 'snapshotCeilingId', 'version']
            .sort()
            .join(',')
      ) {
        throw new MobileTransactionCursorError();
      }
      return {
        date: value.date,
        id: value.id as number,
        snapshotCeilingId: value.snapshotCeilingId as number,
      };
    } catch (error) {
      if (error instanceof MobileTransactionCursorError) throw error;
      throw new MobileTransactionCursorError();
    }
  }

  return Object.freeze({ encode, decode });
}
