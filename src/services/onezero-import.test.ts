import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { insertAccount, insertMember, insertTransaction } from '../__tests__/helpers/fixtures.js';
import { transactions } from '../db/schema.js';

let testDb: TestDb;

vi.mock('../db/connection.js', () => ({
  get db() {
    return testDb.db;
  },
}));

vi.mock('./ownership.js', () => ({ applyOwnership: vi.fn() }));
vi.mock('../ai/agent.js', () => ({ batchCategorize: vi.fn().mockResolvedValue(undefined) }));

const { commitOneZeroImport, createOneZeroImportPreview } = await import('./onezero-import.js');

const headers = [
  'תאריך תנועה',
  'תאריך ערך',
  'סוג פעולה',
  'תיאור',
  'סכום פעולה',
  'מטבע',
  'חיוב/זיכוי',
  'יתרה',
  'אסמכתא',
];

function workbookBuffer(): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([
    headers,
    ['04/08/2026', '03/08/2026', 'העברה', 'Existing', -150, 'ILS', 'חיוב', 1000, 'ref-1'],
    ['05/08/2026', '05/08/2026', 'עמלה', 'New', -25, 'ILS', 'חיוב', 975, 'ref-2'],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Movements');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

describe('One Zero import', () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterAll(() => {
    testDb?.close();
  });

  it('links scraped rows, inserts new rows, and deduplicates a repeated statement', () => {
    const member = insertMember(testDb.db);
    const account = insertAccount(testDb.db, {
      companyId: 'oneZero',
      displayName: 'One Zero',
      memberId: member.id,
    });
    insertTransaction(testDb.db, account.id, {
      date: '2026-08-03',
      processedDate: '2026-08-04',
      chargedAmount: -150,
      originalAmount: -150,
      description: 'Scraped wording',
    });
    const buffer = workbookBuffer();

    expect(createOneZeroImportPreview(account.id, buffer)).toMatchObject({
      newCount: 1,
      matchedExistingCount: 1,
      duplicateCount: 0,
      ambiguousCount: 0,
    });
    expect(commitOneZeroImport(account.id, buffer)).toEqual({
      imported: 1,
      linked: 1,
      duplicates: 0,
    });

    const stored = testDb.db
      .select({ meta: transactions.meta })
      .from(transactions)
      .all()
      .map(({ meta }) => JSON.parse(meta ?? '{}').oneZeroReference)
      .sort();
    expect(stored).toEqual(['ref-1', 'ref-2']);
    expect(createOneZeroImportPreview(account.id, buffer)).toMatchObject({
      newCount: 0,
      matchedExistingCount: 0,
      duplicateCount: 2,
      ambiguousCount: 0,
    });
  });
});
