import { sql } from 'drizzle-orm';
import { db } from './connection.js';

/**
 * Search the FTS5 index for transaction IDs matching the given search term.
 * Returns an array of transaction IDs (rowids), or an empty array if no matches.
 */
export function searchTransactionIds(search: string): number[] {
  return db.all<{ rowid: number }>(
    sql`SELECT rowid FROM transactions_fts WHERE transactions_fts MATCH ${search} ORDER BY rank LIMIT 1000`
  ).map(r => r.rowid);
}
