import { createHash } from 'node:crypto';

/** Source namespaces are deliberately separate: movement IDs and statement references
 * are issued by different One Zero systems and can legitimately overlap. */
export const ONE_ZERO_XLS_SOURCE = 'oneZero:xls' as const;
export const ONE_ZERO_SCRAPER_SOURCE = 'oneZero:scraper' as const;

const HEBREW_WORDS_REGEX = /[\u0590-\u05FF][\u0590-\u05FF"'\-_ /\\]*[\u0590-\u05FF]/g;

/**
 * Mirrors israeli-bank-scrapers-core's OneZeroScraper.sanitizeHebrew implementation.
 * One Zero exports Hebrew strings with U+202D and reversed Hebrew runs; keeping this
 * behaviour in one place makes statement hashes compatible with scraper hashes.
 */
export function sanitizeOneZeroDescription(text: string): string {
  if (!text.includes('\u202d')) return text.trim();

  const plainString = text.replace(/\u202d/gi, '').trim();
  const rangesToReverse = [...plainString.matchAll(HEBREW_WORDS_REGEX)].map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));

  const out: string[] = [];
  let index = 0;
  for (const { start, end } of rangesToReverse) {
    out.push(plainString.substring(index, start));
    index += start - index;
    out.push(...[...plainString.substring(start, end)].reverse());
    index += end - start;
  }
  out.push(plainString.substring(index));
  return out.join('');
}

/** The legacy hash remains the canonical scraper identity for backwards compatibility. */
export function computeLegacyTransactionHash(
  accountId: number,
  date: string,
  chargedAmount: number,
  description: string,
): string {
  const raw = `${accountId}:${date}:${chargedAmount}:${description}`;
  return createHash('sha256').update(raw).digest('hex');
}

/** A deterministic collision suffix for legitimate same-day identical transactions. */
export function computeCollisionTransactionHash(
  baseHash: string,
  source: string,
  externalId: string,
) {
  return createHash('sha256').update(`${baseHash}:${source}:${externalId}`).digest('hex');
}

export function toExternalId(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const externalId = String(value).trim();
  return externalId.length > 0 ? externalId : null;
}

/**
 * One Zero's statement and scraper can assign the movement/value dates in the
 * opposite order (or expose only one of them).  Treat an exact equality with
 * either existing date field as a match; deliberately do not allow date
 * arithmetic such as a +/- one-day window.
 */
export function oneZeroDateFieldsOverlap(
  source: { movementDate: string; valueDate: string },
  existing: { date: string; processedDate: string },
): boolean {
  return (
    source.movementDate === existing.date ||
    source.movementDate === existing.processedDate ||
    source.valueDate === existing.date ||
    source.valueDate === existing.processedDate
  );
}

/**
 * Reserve an existing transaction that already owns a statement source ID.
 * Returning false for an absent ID keeps callers from claiming fallback targets
 * when the source lookup did not resolve to a transaction.
 */
export function claimOneZeroSourceTarget(
  transactionId: number | null | undefined,
  claimed: Set<number>,
): boolean {
  if (transactionId == null || !Number.isSafeInteger(transactionId) || transactionId <= 0) {
    return false;
  }
  claimed.add(transactionId);
  return true;
}
