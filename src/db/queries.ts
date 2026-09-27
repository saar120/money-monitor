import { sql } from 'drizzle-orm';
import { db } from './connection.js';

/**
 * Search the FTS5 index for transaction IDs matching the given search term.
 * Returns an array of transaction IDs (rowids), or an empty array if no matches.
 */
export function searchTransactionIds(search: string): number[] {
  const terms = search.match(/[\p{L}\p{N}]+/gu);
  if (!terms?.length) return [];
  const query = terms.map((term) => `"${term}"`).join(' ');
  return db
    .all<{
      rowid: number;
    }>(
      sql`SELECT rowid FROM transactions_fts WHERE transactions_fts MATCH ${query} ORDER BY rank LIMIT 1000`,
    )
    .map((row) => row.rowid);
}
