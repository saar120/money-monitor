import { createHash, randomBytes } from 'node:crypto';
import XLSX from 'xlsx';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { accountBalanceHistory, accounts, transactionSources, transactions } from '../db/schema.js';
import { applyOwnership } from './ownership.js';
import { batchCategorize } from '../ai/agent.js';
import {
  computeCollisionTransactionHash,
  computeLegacyTransactionHash,
  claimOneZeroSourceTarget,
  ONE_ZERO_XLS_SOURCE,
  oneZeroDateFieldsOverlap,
  sanitizeOneZeroDescription,
} from './transaction-identity.js';
import { toIsraelDateStr } from '../shared/dates.js';

export const ONE_ZERO_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const ONE_ZERO_IMPORT_TOKEN_TTL_MS = 15 * 60 * 1000;

const REQUIRED_HEADERS = [
  'תאריך תנועה',
  'תאריך ערך',
  'סוג פעולה',
  'תיאור',
  'סכום פעולה',
  'מטבע',
  'חיוב/זיכוי',
  'יתרה',
  'אסמכתא',
] as const;

export interface OneZeroParsedRow {
  row: number;
  movementDate: string;
  valueDate: string;
  operationType: string;
  description: string;
  amount: number;
  currency: string;
  debitCredit: string;
  balance: number | null;
  reference: string;
}

export interface OneZeroInvalidRow {
  row: number;
  reason: string;
}

export interface OneZeroParseResult {
  rows: OneZeroParsedRow[];
  rowCount: number;
  invalidRows: OneZeroInvalidRow[];
}

export interface OneZeroBalanceCandidate {
  balance: number;
  date: string;
}

export interface OneZeroImportPreview {
  importToken: string;
  accountId: number;
  fileName: string;
  rowCount: number;
  dateRange: { from: string; to: string } | null;
  newCount: number;
  duplicateCount: number;
  matchedExistingCount: number;
  ambiguousCount: number;
  invalidRows: OneZeroInvalidRow[];
  balanceCandidate: OneZeroBalanceCandidate | null;
}

export interface OneZeroImportCommitResult {
  imported: number;
  linked: number;
  duplicates: number;
  ambiguous: number;
  accountBalance?: number;
}

type ImportClassification =
  | { kind: 'duplicate'; row: OneZeroParsedRow; transactionId: number }
  | { kind: 'matched'; row: OneZeroParsedRow; transactionId: number }
  | { kind: 'new'; row: OneZeroParsedRow; hash: string }
  | { kind: 'ambiguous'; row: OneZeroParsedRow };

interface ImportAnalysis {
  parsed: OneZeroParseResult;
  classifications: ImportClassification[];
  dateRange: { from: string; to: string } | null;
  balanceCandidate: OneZeroBalanceCandidate | null;
  newCount: number;
  duplicateCount: number;
  matchedExistingCount: number;
  ambiguousCount: number;
}

interface ImportSession {
  accountId: number;
  fileName: string;
  buffer: Buffer;
  digest: string;
  expiresAt: number;
  committed: boolean;
}

const importSessions = new Map<string, ImportSession>();

function cleanupImportSessions(now = Date.now()) {
  for (const [token, session] of importSessions) {
    if (session.expiresAt <= now || session.committed) importSessions.delete(token);
  }
}

function parseDateCell(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toIsraelDateStr(value.toISOString());
  }

  const text = String(value ?? '').trim();
  if (!text) return null;

  // One Zero's XLS exports use DD/MM/YYYY. Do not let JavaScript parse this
  // locale-dependent format, and reject impossible dates explicitly.
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    const year = Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }
    return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
      .toString()
      .padStart(2, '0')}`;
  }

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ]|$)/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }
    return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
      .toString()
      .padStart(2, '0')}`;
  }

  // This is mainly for workbooks whose date cells are serial numbers after
  // conversion by a third-party XLS reader.
  const serial = Number(text);
  if (Number.isFinite(serial) && serial > 0 && serial < 100000) {
    const parsed = XLSX.SSF.parse_date_code(serial);
    if (parsed) {
      return parseDateCell(
        `${parsed.d.toString().padStart(2, '0')}/${parsed.m.toString().padStart(2, '0')}/${parsed.y}`,
      );
    }
  }

  return null;
}

function parseNumericCell(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value ?? '')
    .trim()
    .replace(/[₪,\s]/g, '')
    .replace(/^\((.*)\)$/, '-$1');
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonEmptyText(value: unknown): string {
  return String(value ?? '')
    .replace(/\r/g, '')
    .trim();
}

function isNonEmptyRow(row: unknown[]): boolean {
  return row.some((cell) => String(cell ?? '').trim().length > 0);
}

/** Parse and validate a One Zero .xls/.xlsx workbook without touching the database. */
export function parseOneZeroWorkbook(buffer: Buffer): OneZeroParseResult {
  if (buffer.length === 0) throw new Error('The uploaded file is empty');
  if (buffer.length > ONE_ZERO_IMPORT_MAX_BYTES) throw new Error('The uploaded file is too large');

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: false, WTF: true });
  } catch {
    throw new Error('The uploaded file is not a readable Excel workbook');
  }
  if (workbook.SheetNames.length !== 1) {
    throw new Error('The workbook must contain exactly one sheet');
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    raw: false,
    blankrows: true,
  });
  const headers = (rows[0] ?? []).map((cell) => String(cell ?? '').trim());
  if (
    headers.length !== REQUIRED_HEADERS.length ||
    REQUIRED_HEADERS.some((header, index) => headers[index] !== header)
  ) {
    throw new Error('The workbook headers do not match the One Zero statement format');
  }

  const parsedRows: OneZeroParsedRow[] = [];
  const invalidRows: OneZeroInvalidRow[] = [];
  const seenReferences = new Set<string>();
  let rowCount = 0;

  for (let index = 1; index < rows.length; index += 1) {
    const raw = rows[index] ?? [];
    if (!isNonEmptyRow(raw)) continue;
    const rowNumber = index + 1;
    rowCount += 1;
    const movementDate = parseDateCell(raw[0]);
    const valueDate = parseDateCell(raw[1]);
    const operationType = nonEmptyText(raw[2]);
    const rawDescription = nonEmptyText(raw[3]);
    const amount = parseNumericCell(raw[4]);
    const currency = nonEmptyText(raw[5]).toUpperCase();
    const debitCredit = nonEmptyText(raw[6]);
    const balance = parseNumericCell(raw[7]);
    const reference = nonEmptyText(raw[8]);

    let reason: string | null = null;
    if (!movementDate) reason = 'Invalid movement date';
    else if (!valueDate) reason = 'Invalid value date';
    else if (!operationType) reason = 'Missing operation type';
    else if (!rawDescription) reason = 'Missing description';
    else if (amount == null) reason = 'Invalid amount';
    else if (currency !== 'ILS') reason = 'Only ILS rows are supported';
    else if (balance == null) reason = 'Invalid balance';
    else if (!reference) reason = 'Missing source reference';
    else if (seenReferences.has(reference)) reason = 'Duplicate source reference';

    if (reason) {
      invalidRows.push({ row: rowNumber, reason });
      continue;
    }
    // The checks above establish these values; the assertions keep that
    // relationship explicit to TypeScript after the nullable parsing helpers.
    if (!movementDate || !valueDate || amount == null || balance == null) continue;
    seenReferences.add(reference);
    parsedRows.push({
      row: rowNumber,
      movementDate,
      valueDate,
      operationType,
      description: sanitizeOneZeroDescription(rawDescription),
      amount,
      currency,
      debitCredit,
      balance,
      reference,
    });
  }

  return { rows: parsedRows, rowCount, invalidRows };
}

function amountCents(amount: number): number {
  return Math.round(amount * 100);
}

function datesOverlap(row: OneZeroParsedRow, existing: typeof transactions.$inferSelect): boolean {
  return oneZeroDateFieldsOverlap(row, existing);
}

function buildDateRange(rows: OneZeroParsedRow[]): { from: string; to: string } | null {
  if (rows.length === 0) return null;
  const dates = rows.map((row) => row.valueDate).sort();
  return { from: dates[0], to: dates[dates.length - 1] };
}

function buildBalanceCandidate(rows: OneZeroParsedRow[]): OneZeroBalanceCandidate | null {
  const withBalances = rows.filter((row) => row.balance != null);
  if (withBalances.length === 0) return null;
  // The statement's balance is as-of the movement date. Pick the newest date;
  // preserve input order for same-day rows (the workbook is already ordered).
  const latest = withBalances.reduce((current, candidate) =>
    candidate.movementDate > current.movementDate ? candidate : current,
  );
  return { balance: latest.balance!, date: latest.movementDate };
}

function loadAccountTransactions(accountId: number) {
  return db.select().from(transactions).where(eq(transactions.accountId, accountId)).all();
}

function analyzeImport(accountId: number, parsed: OneZeroParseResult): ImportAnalysis {
  const existing = loadAccountTransactions(accountId);
  const existingByHash = new Map(existing.map((transaction) => [transaction.hash, transaction]));
  const existingByCents = new Map<number, typeof existing>();
  for (const transaction of existing) {
    const cents = amountCents(transaction.chargedAmount);
    const list = existingByCents.get(cents);
    if (list) list.push(transaction);
    else existingByCents.set(cents, [transaction]);
  }

  const sourceRows = db
    .select({
      externalId: transactionSources.externalId,
      transactionId: transactionSources.transactionId,
    })
    .from(transactionSources)
    .where(
      and(
        eq(transactionSources.accountId, accountId),
        eq(transactionSources.source, ONE_ZERO_XLS_SOURCE),
      ),
    )
    .all();
  const existingBySource = new Map(
    sourceRows.map((source) => [source.externalId, source.transactionId]),
  );

  const claimedExisting = new Set<number>();
  const usedHashes = new Set(existing.map((transaction) => transaction.hash));
  const classifications: ImportClassification[] = [];
  let duplicateCount = 0;
  let matchedExistingCount = 0;
  let ambiguousCount = 0;

  for (const row of parsed.rows) {
    const exactSourceId = existingBySource.get(row.reference);
    if (exactSourceId != null) {
      // A duplicate source row already owns this transaction. Keep it claimed
      // for this analysis so another legitimate statement row cannot reuse the
      // same target through the amount/date fallback below.
      claimOneZeroSourceTarget(exactSourceId, claimedExisting);
      duplicateCount += 1;
      classifications.push({ kind: 'duplicate', row, transactionId: exactSourceId });
      continue;
    }

    const baseHash = computeLegacyTransactionHash(
      accountId,
      row.valueDate,
      row.amount,
      row.description,
    );
    const canonical = existingByHash.get(baseHash);
    if (canonical && !claimedExisting.has(canonical.id)) {
      claimedExisting.add(canonical.id);
      matchedExistingCount += 1;
      classifications.push({ kind: 'matched', row, transactionId: canonical.id });
      continue;
    }

    const fallbackCandidates = (existingByCents.get(amountCents(row.amount)) ?? []).filter(
      (candidate) => datesOverlap(row, candidate) && !claimedExisting.has(candidate.id),
    );
    if (fallbackCandidates.length === 1) {
      const candidate = fallbackCandidates[0];
      claimedExisting.add(candidate.id);
      matchedExistingCount += 1;
      classifications.push({ kind: 'matched', row, transactionId: candidate.id });
      continue;
    }
    if (fallbackCandidates.length > 1) {
      ambiguousCount += 1;
      classifications.push({ kind: 'ambiguous', row });
      continue;
    }

    let hash = baseHash;
    if (usedHashes.has(hash))
      hash = computeCollisionTransactionHash(baseHash, ONE_ZERO_XLS_SOURCE, row.reference);
    let collision = 0;
    while (usedHashes.has(hash)) {
      collision += 1;
      hash = computeCollisionTransactionHash(
        computeCollisionTransactionHash(baseHash, ONE_ZERO_XLS_SOURCE, row.reference),
        ONE_ZERO_XLS_SOURCE,
        `${row.reference}:${collision}`,
      );
    }
    usedHashes.add(hash);
    classifications.push({ kind: 'new', row, hash });
  }

  const newCount = classifications.filter((item) => item.kind === 'new').length;
  return {
    parsed,
    classifications,
    dateRange: buildDateRange(parsed.rows),
    balanceCandidate: buildBalanceCandidate(parsed.rows),
    newCount,
    duplicateCount,
    matchedExistingCount,
    ambiguousCount,
  };
}

function fileDigest(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function createOneZeroImportPreview(
  accountId: number,
  fileName: string,
  buffer: Buffer,
): OneZeroImportPreview {
  cleanupImportSessions();
  const parsed = parseOneZeroWorkbook(buffer);
  const analysis = analyzeImport(accountId, parsed);
  const importToken = randomBytes(32).toString('base64url');
  importSessions.set(importToken, {
    accountId,
    fileName,
    buffer: Buffer.from(buffer),
    digest: fileDigest(buffer),
    expiresAt: Date.now() + ONE_ZERO_IMPORT_TOKEN_TTL_MS,
    committed: false,
  });

  return {
    importToken,
    accountId,
    fileName,
    rowCount: parsed.rowCount,
    dateRange: analysis.dateRange,
    newCount: analysis.newCount,
    duplicateCount: analysis.duplicateCount,
    matchedExistingCount: analysis.matchedExistingCount,
    ambiguousCount: analysis.ambiguousCount,
    invalidRows: parsed.invalidRows,
    balanceCandidate: analysis.balanceCandidate,
  };
}

export class OneZeroImportError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function commitOneZeroImport(
  accountId: number,
  importToken: string,
  updateBalance = false,
): OneZeroImportCommitResult {
  cleanupImportSessions();
  const session = importSessions.get(importToken);
  if (!session || session.expiresAt <= Date.now()) {
    throw new OneZeroImportError('Import token is missing or expired', 400);
  }
  if (session.accountId !== accountId) {
    throw new OneZeroImportError('Import token does not belong to this account', 403);
  }
  if (session.committed) {
    throw new OneZeroImportError('Import token has already been committed', 409);
  }
  // The file is not accepted again on commit, but reparsing the immutable token
  // payload ensures all validations are rerun and protects against stale previews.
  if (fileDigest(session.buffer) !== session.digest) {
    throw new OneZeroImportError('Import token data is invalid', 400);
  }
  const parsed = parseOneZeroWorkbook(session.buffer);
  const analysis = analyzeImport(accountId, parsed);
  if (parsed.invalidRows.length > 0) {
    throw new OneZeroImportError('Import contains invalid rows', 400, {
      invalidRows: parsed.invalidRows,
    });
  }
  if (analysis.ambiguousCount > 0) {
    throw new OneZeroImportError('Import contains ambiguous rows', 409, {
      ambiguous: analysis.ambiguousCount,
    });
  }

  const insertedIds: number[] = [];
  let imported = 0;
  let linked = 0;
  let duplicates = 0;
  let accountBalance: number | undefined;

  db.transaction((transaction) => {
    const account = transaction
      .select({ memberId: accounts.memberId })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .get();
    if (!account) throw new OneZeroImportError('Account not found', 404);

    for (const classification of analysis.classifications) {
      if (classification.kind === 'duplicate') {
        duplicates += 1;
        continue;
      }
      if (classification.kind === 'matched') {
        const sourceInsert = transaction
          .insert(transactionSources)
          .values({
            transactionId: classification.transactionId,
            accountId,
            source: ONE_ZERO_XLS_SOURCE,
            externalId: classification.row.reference,
          })
          .onConflictDoNothing({
            target: [
              transactionSources.accountId,
              transactionSources.source,
              transactionSources.externalId,
            ],
          })
          .run();
        if (sourceInsert.changes > 0) linked += 1;
        else duplicates += 1;
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
          originalCurrency: row.currency,
          chargedAmount: row.amount,
          description: row.description,
          memo: null,
          type: 'normal',
          status: 'completed',
          installmentNumber: null,
          installmentTotal: null,
          meta: JSON.stringify({
            oneZeroOperationType: row.operationType,
            oneZeroDebitCredit: row.debitCredit,
          }),
          expenseOwnerType: account.memberId != null ? 'member' : 'unassigned',
          expenseOwnerMemberId: account.memberId ?? null,
          ownerSource: account.memberId != null ? 'account' : 'unassigned',
          ownerConfidence: account.memberId != null ? 1 : null,
          hash: classification.hash,
        })
        .returning({ id: transactions.id })
        .get();
      const transactionId = Number(inserted.id);
      transaction
        .insert(transactionSources)
        .values({
          transactionId,
          accountId,
          source: ONE_ZERO_XLS_SOURCE,
          externalId: row.reference,
        })
        .run();
      imported += 1;
      insertedIds.push(transactionId);
    }

    if (updateBalance && analysis.balanceCandidate) {
      const latestBalance = transaction
        .select({ date: accountBalanceHistory.date })
        .from(accountBalanceHistory)
        .where(eq(accountBalanceHistory.accountId, accountId))
        .orderBy(asc(accountBalanceHistory.date))
        .all()
        .at(-1);
      if (!latestBalance || analysis.balanceCandidate.date >= latestBalance.date) {
        accountBalance = analysis.balanceCandidate.balance;
        transaction
          .update(accounts)
          .set({ balance: accountBalance })
          .where(eq(accounts.id, accountId))
          .run();
        transaction
          .insert(accountBalanceHistory)
          .values({
            accountId,
            date: analysis.balanceCandidate.date,
            balance: accountBalance,
          })
          .onConflictDoUpdate({
            target: [accountBalanceHistory.accountId, accountBalanceHistory.date],
            set: { balance: accountBalance },
          })
          .run();
      }
    }
  });

  session.committed = true;
  importSessions.delete(importToken);

  if (insertedIds.length > 0) {
    // Ownership is deterministic and local; apply it before the optional AI call.
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

  return {
    imported,
    linked,
    duplicates,
    ambiguous: 0,
    ...(accountBalance !== undefined ? { accountBalance } : {}),
  };
}

export function getOneZeroImportSessionCount(): number {
  cleanupImportSessions();
  return importSessions.size;
}
