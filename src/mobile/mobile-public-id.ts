import { createHmac } from 'node:crypto';

export const MOBILE_PUBLIC_ID_DIGEST_LENGTH = 22 as const;
export type MobilePublicIdKind = 'account' | 'category' | 'transaction';

const PUBLIC_ID_PATTERNS: Readonly<Record<MobilePublicIdKind, RegExp>> = {
  account: /^account_[A-Za-z0-9_-]{22}$/,
  category: /^category_[A-Za-z0-9_-]{22}$/,
  transaction: /^transaction_[A-Za-z0-9_-]{22}$/,
};

export type MobilePublicIdProjector = (
  kind: MobilePublicIdKind,
  localId: number | string,
) => string;

/**
 * Derives the stable identifiers already used by the Bootstrap contract.
 * Changing the input string, digest encoding, or truncation would break links
 * between Home, Activity, Search, and detail.
 */
export function createMobilePublicIdProjector(publicIdKey: string): MobilePublicIdProjector {
  if (publicIdKey.length < 32) {
    throw new Error('Mobile public ID key must contain at least 32 characters');
  }

  return (kind, localId) => {
    const digest = createHmac('sha256', publicIdKey)
      .update(`${kind}:${String(localId)}`)
      .digest('base64url')
      .slice(0, MOBILE_PUBLIC_ID_DIGEST_LENGTH);
    return `${kind}_${digest}`;
  };
}

export function isMobilePublicId(value: string, kind: MobilePublicIdKind): boolean {
  return PUBLIC_ID_PATTERNS[kind].test(value);
}
