import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseOneZeroWorkbook } from './onezero-parser.js';

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

function workbookBuffer(rows: unknown[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Movements');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

describe('One Zero workbook parser', () => {
  it('parses dates, signed amounts, references as text, and sanitizes Hebrew descriptions', () => {
    const result = parseOneZeroWorkbook(
      workbookBuffer([
        [
          '04/08/2026',
          '03/08/2026',
          'העברות',
          '‭טסקט',
          '-150.00',
          'ILS',
          'חיוב',
          '54,792.37',
          '25-21913030',
        ],
      ]),
    );

    expect(result.rowCount).toBe(1);
    expect(result.invalidRows).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      row: 2,
      movementDate: '2026-08-04',
      valueDate: '2026-08-03',
      amount: -150,
      currency: 'ILS',
      description: 'טקסט',
      reference: '25-21913030',
    });
  });

  it('reports malformed rows while retaining valid rows and rejects duplicate references', () => {
    const result = parseOneZeroWorkbook(
      workbookBuffer([
        ['04/08/2026', '03/08/2026', 'העברות', 'Valid', '1.25', 'ILS', 'זיכוי', '2.25', 'r1'],
        ['04/08/2026', '04/08/2026', 'העברות', 'Duplicate', '-1', 'ILS', 'חיוב', '1.25', 'r1'],
        ['04/08/2026', '04/08/2026', 'העברות', 'Foreign', '1', 'USD', 'זיכוי', '3.25', 'r2'],
        ['bad', '03/08/2026', 'העברות', 'Missing date', '-1', 'ILS', 'חיוב', '1', 'r3'],
      ]),
    );

    expect(result.rowCount).toBe(4);
    expect(result.rows).toHaveLength(1);
    expect(result.invalidRows).toEqual([
      { row: 3, reason: 'Duplicate source reference' },
      { row: 4, reason: 'Only ILS rows are supported' },
      { row: 5, reason: 'Invalid movement date' },
    ]);
  });

  it('rejects a workbook with an unexpected header shape', () => {
    const sheet = XLSX.utils.aoa_to_sheet([['wrong', ...headers.slice(1)]]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Movements');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    expect(() => parseOneZeroWorkbook(buffer)).toThrow(/headers/);
  });

  it('parses numeric Excel date serials without relying on the ESM namespace shape', () => {
    const result = parseOneZeroWorkbook(
      workbookBuffer([
        [45873, 45872, 'העברות', 'Serial date', '-1', 'ILS', 'חיוב', '1', 'serial-1'],
      ]),
    );

    expect(result.invalidRows).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      movementDate: '2025-08-04',
      valueDate: '2025-08-03',
    });
  });

  it('rejects extra columns instead of accepting a non-exact statement header row', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      [...headers, 'עמודה נוספת'],
      ['04/08/2026', '03/08/2026', 'העברות', 'Extra column', '-1', 'ILS', 'חיוב', '1', 'r1', 'x'],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Movements');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    expect(() => parseOneZeroWorkbook(buffer)).toThrow(/headers/);
  });
});
