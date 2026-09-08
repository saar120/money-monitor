import { describe, expect, it } from 'vitest';
import { createMobilePublicIdProjector, isMobilePublicId } from './mobile-public-id.js';

const KEY = 'production-mobile-public-id-key-32-chars-minimum';

describe('mobile public identifiers', () => {
  it('preserves the established Bootstrap HMAC projection byte-for-byte', () => {
    const project = createMobilePublicIdProjector(KEY);

    expect(project('transaction', 42)).toBe('transaction_yIWYGJTtbQrp1gL9ucu7hx');
    expect(project('account', 7)).toBe('account_KhcwWcEfN1XdZYW4awmNQv');
    expect(project('category', 'groceries')).toBe('category_mevaqs_MbNI_gRP50-Xhch');
    expect(project('transaction', 42)).toBe(project('transaction', 42));
  });

  it('requires a private key with at least 32 characters', () => {
    expect(() => createMobilePublicIdProjector('too-short')).toThrow(
      'Mobile public ID key must contain at least 32 characters',
    );
  });

  it('validates the exact kind and digest length', () => {
    const transaction = createMobilePublicIdProjector(KEY)('transaction', 42);

    expect(isMobilePublicId(transaction, 'transaction')).toBe(true);
    expect(isMobilePublicId(transaction, 'account')).toBe(false);
    expect(isMobilePublicId('transaction_42', 'transaction')).toBe(false);
    expect(isMobilePublicId(`${transaction}x`, 'transaction')).toBe(false);
  });
});
