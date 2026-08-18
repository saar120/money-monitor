import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { accounts, transactions } from '../db/schema.js';
import { applyOwnership } from './ownership.js';
import { batchCategorize } from '../ai/agent.js';
import {
  computeCollisionTransactionHash,
  computeLegacyTransactionHash,
  oneZeroDateFieldsOverlap,
} from './transaction-identity.js';
import {
  parseOneZeroWorkbook,
  type OneZeroInvalidRow,
  type OneZeroParsedRow,
  type OneZeroParseResult,
} from './onezero-parser.js';

const REFERENCE_META_KEY = 'oneZeroReference';

export interface OneZeroImportPreview {
  rowCount: number;
  dateRange: { from: string; to: string } | null;
  newCount: number;
  duplicateCount: number;
  matchedExistingCount: number;
  ambiguousCount: number;
  invalidRows: OneZeroInvalidRow[];
}

export interface OneZeroImportCommitResult {
  imported: number;
  linked: number;
  duplicates: number;
}

type ExistingTransaction = typeof transactions.$inferSelect;
type ImportClassification =
  | { kind: 'duplicate'; row: OneZeroParsedRow }
  | { kind: 'matched'; row: OneZeroParsedRow; transactionId: number; meta: string | null }
  | { kind: 'new'; row: OneZeroParsedRow; hash: string }
  | { kind: 'ambiguous'; row: OneZeroParsedRow };

interface ImportAnalysis {
  classifications: ImportClassification[];
  dateRange: { from: string; to: string } | null;
  newCount: number;
  duplicateCount: number;
  matchedExistingCount: number;
  ambiguousCount: number;
}

function parseMeta(meta: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(meta ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function getReference(transaction: ExistingTransaction): string | null {
  const reference = parseMeta(transaction.meta)[REFERENCE_META_KEY];
  return typeof reference === 'string' && reference.length > 0 ? reference : null;
}

function addReference(meta: string | null, reference: string): string {
  return JSON.stringify({ ...parseMeta(meta), [REFERENCE_META_KEY]: reference });
}

function amountCents(amount: number): number {
  return Math.round(amount * 100);
}

function buildDateRange(rows: OneZeroParsedRow[]): { from: string; to: string } | null {
  if (rows.length === 0) return null;
  const dates = rows.map((row) => row.valueDate).sort();
  return { from: dates[0], to: dates[dates.length - 1] };
}

function analyzeImport(accountId: number, parsed: OneZeroParseResult): ImportAnalysis {
  const existing = db
    .select()
    .from(transactions)
    .where(eq(transactions.accountId, accountId))
    .all();
  const existingByHash = new Map(existing.map((transaction) => [transaction.hash, transaction]));
  const existingByReference = new Map(
    existing.flatMap((transaction) => {
      const reference = getReference(transaction);
      return reference ? [[reference, transaction] as const] : [];
    }),
  );
  const existingByCents = new Map<number, ExistingTransaction[]>();

  for (const transaction of existing) {
    const cents = amountCents(transaction.chargedAmount);
    const matches = existingByCents.get(cents);
    if (matches) matches.push(transaction);
    else existingByCents.set(cents, [transaction]);
  }

  const claimed = new Set<number>();
  const usedHashes = new Set(existing.map((transaction) => transaction.hash));
  const classifications: ImportClassification[] = [];

  for (const row of parsed.rows) {
    const exact = existingByReference.get(row.reference);
    if (exact) {
      claimed.add(exact.id);
      classifications.push({ kind: 'duplicate', row });
      continue;
    }

    const baseHash = computeLegacyTransactionHash(
      accountId,
      row.valueDate,
      row.amount,
      row.description,
    );
    const canonical = existingByHash.get(baseHash);
    if (canonical && !claimed.has(canonical.id)) {
      claimed.add(canonical.id);
      classifications.push({
        kind: 'matched',
        row,
        transactionId: canonical.id,
        meta: canonical.meta,
      });
      continue;
    }

    const fallback = (existingByCents.get(amountCents(row.amount)) ?? []).filter(
      (candidate) => oneZeroDateFieldsOverlap(row, candidate) && !claimed.has(candidate.id),
    );
    if (fallback.length === 1) {
      claimed.add(fallback[0].id);
      classifications.push({
        kind: 'matched',
        row,
        transactionId: fallback[0].id,
        meta: fallback[0].meta,
      });
      continue;
    }
    if (fallback.length > 1) {
      classifications.push({ kind: 'ambiguous', row });
      continue;
    }

    const hash = usedHashes.has(baseHash)
      ? computeCollisionTransactionHash(baseHash, row.reference)
      : baseHash;
    usedHashes.add(hash);
    classifications.push({ kind: 'new', row, hash });
  }

  return {
    classifications,
    dateRange: buildDateRange(parsed.rows),
    newCount: classifications.filter((item) => item.kind === 'new').length,
    duplicateCount: classifications.filter((item) => item.kind === 'duplicate').length,
    matchedExistingCount: classifications.filter((item) => item.kind === 'matched').length,
    ambiguousCount: classifications.filter((item) => item.kind === 'ambiguous').length,
  };
}

export function createOneZeroImportPreview(
  accountId: number,
  buffer: Buffer,
): OneZeroImportPreview {
  const parsed = parseOneZeroWorkbook(buffer);
  const analysis = analyzeImport(accountId, parsed);

  return {
    rowCount: parsed.rowCount,
    dateRange: analysis.dateRange,
    newCount: analysis.newCount,
    duplicateCount: analysis.duplicateCount,
    matchedExistingCount: analysis.matchedExistingCount,
    ambiguousCount: analysis.ambiguousCount,
    invalidRows: parsed.invalidRows,
  };
}

export function commitOneZeroImport(accountId: number, buffer: Buffer): OneZeroImportCommitResult {
  const parsed = parseOneZeroWorkbook(buffer);
  const analysis = analyzeImport(accountId, parsed);
  if (parsed.invalidRows.length > 0) throw new Error('Import contains invalid rows');
  if (analysis.ambiguousCount > 0) throw new Error('Import contains ambiguous rows');

  const insertedIds: number[] = [];
  let imported = 0;
  let linked = 0;
  let duplicates = 0;

  db.transaction((transaction) => {
    const account = transaction
      .select({ memberId: accounts.memberId })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .get();
    if (!account) throw new Error('Account not found');

    for (const classification of analysis.classifications) {
      if (classification.kind === 'duplicate') {
        duplicates += 1;
        continue;
      }

      if (classification.kind === 'matched') {
        transaction
          .update(transactions)
          .set({ meta: addReference(classification.meta, classification.row.reference) })
          .where(eq(transactions.id, classification.transactionId))
          .run();
        linked += 1;
        continue;
      }

      if (classification.kind === 'ambiguous') continue;

      const row = classification.row;
      const inserted = transaction
        .insert(transactions)
        .values({
          accountId,
          identifier: null,
          date: row.valueDate,
          processedDate: row.movementDate,
          originalAmount: row.amount,
          originalCurrency: 'ILS',
          chargedAmount: row.amount,
          description: row.description,
          memo: null,
          type: 'normal',
          status: 'completed',
          installmentNumber: null,
          installmentTotal: null,
          meta: addReference(null, row.reference),
          expenseOwnerType: account.memberId != null ? 'member' : 'unassigned',
          expenseOwnerMemberId: account.memberId ?? null,
          ownerSource: account.memberId != null ? 'account' : 'unassigned',
          ownerConfidence: account.memberId != null ? 1 : null,
          hash: classification.hash,
        })
        .returning({ id: transactions.id })
        .get();

      imported += 1;
      insertedIds.push(inserted.id);
    }
  });

  if (insertedIds.length > 0) {
    applyOwnership({ ids: insertedIds });
    void batchCategorize(insertedIds.length, insertedIds)
      .then(() => applyOwnership({ ids: insertedIds }))
      .catch((error) => {
        console.error(
          '[OneZero import] Background categorization failed:',
          error instanceof Error ? error.message : error,
        );
      });
  }

  return { imported, linked, duplicates };
}
