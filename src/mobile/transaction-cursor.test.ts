import { describe, expect, it } from 'vitest';
import {
  canonicalTransactionFilterFingerprint,
  createMobileTransactionCursorCodec,
  MobileTransactionCursorError,
} from './transaction-cursor.js';
import { mobileTransactionQuerySchema } from './transaction-contract.js';

const KEY = 'production-mobile-cursor-secret-with-at-least-32-characters';
const FIXED_IV = Buffer.from('00112233445566778899aabb', 'hex');

function query(overrides: Record<string, unknown> = {}) {
  return mobileTransactionQuerySchema.parse({ q: 'רמי Market', ...overrides });
}

describe('mobile transaction cursor', () => {
  it('round-trips an encrypted keyset position without exposing IDs or search text', () => {
    const codec = createMobileTransactionCursorCodec(KEY, { randomBytes: () => FIXED_IV });
    const filterFingerprint = canonicalTransactionFilterFingerprint(query());
    const binding = { filterFingerprint, financialDate: '2026-07-16' };
    const cursor = codec.encode(
      { date: '2026-07-15', id: 424242, snapshotCeilingId: 500000 },
      binding,
    );

    expect(cursor).toMatch(/^cursor_v1_[A-Za-z0-9_-]+$/);
    expect(cursor.length).toBeLessThanOrEqual(512);
    expect(cursor).not.toContain('424242');
    expect(cursor).not.toContain('רמי');
    expect(cursor).not.toContain('Market');
    expect(codec.decode(cursor, binding)).toEqual({
      date: '2026-07-15',
      id: 424242,
      snapshotCeilingId: 500000,
    });
  });

  it('binds the cursor to every semantic filter and finance date, but not page size', () => {
    const base = canonicalTransactionFilterFingerprint(query({ limit: 10 }));

    expect(canonicalTransactionFilterFingerprint(query({ limit: 50 }))).toBe(base);
    expect(canonicalTransactionFilterFingerprint(query({ direction: 'debit' }))).not.toBe(base);
    expect(canonicalTransactionFilterFingerprint(query({ q: 'Other' }))).not.toBe(base);

    const codec = createMobileTransactionCursorCodec(KEY);
    const cursor = codec.encode(
      { date: '2026-07-15', id: 10, snapshotCeilingId: 20 },
      { filterFingerprint: base, financialDate: '2026-07-16' },
    );
    expect(() =>
      codec.decode(cursor, {
        filterFingerprint: canonicalTransactionFilterFingerprint(query({ q: 'Other' })),
        financialDate: '2026-07-16',
      }),
    ).toThrow(MobileTransactionCursorError);
    expect(() =>
      codec.decode(cursor, { filterFingerprint: base, financialDate: '2026-07-17' }),
    ).toThrow(MobileTransactionCursorError);
  });

  it.each(['bad', 'cursor_v1_', `cursor_v1_${'A'.repeat(502)}`])(
    'rejects malformed cursor %s',
    (cursor) => {
      const codec = createMobileTransactionCursorCodec(KEY);
      expect(() =>
        codec.decode(cursor, {
          filterFingerprint: canonicalTransactionFilterFingerprint(query()),
          financialDate: '2026-07-16',
        }),
      ).toThrow(MobileTransactionCursorError);
    },
  );

  it('rejects tampering and a cursor encrypted by another server secret', () => {
    const binding = {
      filterFingerprint: canonicalTransactionFilterFingerprint(query()),
      financialDate: '2026-07-16',
    };
    const codec = createMobileTransactionCursorCodec(KEY);
    const cursor = codec.encode({ date: '2026-07-15', id: 10, snapshotCeilingId: 20 }, binding);
    const tail = cursor.at(-1) === 'A' ? 'B' : 'A';
    const tampered = `${cursor.slice(0, -1)}${tail}`;

    expect(() => codec.decode(tampered, binding)).toThrow(MobileTransactionCursorError);
    expect(() =>
      createMobileTransactionCursorCodec(`${KEY}-different`).decode(cursor, binding),
    ).toThrow(MobileTransactionCursorError);
  });

  it('rejects short secrets and invalid cursor positions without leaking values', () => {
    expect(() => createMobileTransactionCursorCodec('short')).toThrow(
      'Mobile cursor secret must contain at least 32 characters',
    );
    const codec = createMobileTransactionCursorCodec(KEY);
    expect(() =>
      codec.encode(
        { date: 'not-a-date', id: 0, snapshotCeilingId: 0 },
        {
          filterFingerprint: canonicalTransactionFilterFingerprint(query()),
          financialDate: '2026-07-16',
        },
      ),
    ).toThrow(MobileTransactionCursorError);
  });
});
