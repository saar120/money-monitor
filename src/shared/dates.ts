/**
 * Convert an ISO datetime string to a date-only string (YYYY-MM-DD) in Israel timezone.
 *
 * Israeli bank scrapers return dates at midnight Israel time, which shifts to the
 * previous day in UTC (e.g. Dec 1 00:00 IST → Nov 30 22:00 UTC). This function
 * recovers the correct local date.
 */
export function toIsraelDateStr(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
}

/** Get today's date as YYYY-MM-DD in Israel timezone. */
export function todayInIsrael(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
}

/** Whole days elapsed since `past` (floor). Returns 0 if `past` is today or in the future. */
export function daysElapsedSince(past: Date | string): number {
  const ms = Date.now() - new Date(past).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

/**
 * Get the first day of a month N months ago in Israel timezone (YYYY-MM-DD).
 * E.g. monthsAgoStart(3) on 2026-03-15 → "2025-12-01"
 */
export function monthsAgoStart(months: number): string {
  const [y, m] = todayInIsrael().split('-').map(Number);
  const d = new Date(y, m - 1 - months, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
