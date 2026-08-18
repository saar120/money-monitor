import XLSX from 'xlsx';
import { toIsraelDateStr } from '../shared/dates.js';
import { sanitizeOneZeroDescription } from './transaction-identity.js';

export const ONE_ZERO_IMPORT_MAX_BYTES = 10 * 1024 * 1024;

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

function parseDateCell(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toIsraelDateStr(value.toISOString());
  }

  const text = String(value ?? '').trim();
  if (!text) return null;

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
