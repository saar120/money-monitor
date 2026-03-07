import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { liabilities } from '../db/schema.js';
import { getExchangeRates, convertToIls } from './exchange-rates.js';

function withIls(row: typeof liabilities.$inferSelect, rates: Record<string, number>) {
  return { ...row, currentBalanceIls: convertToIls(row.currentBalance, row.currency, rates) };
}

// ── Reads ──

export async function listLiabilities(opts: { includeInactive?: boolean } = {}) {
  const { rates } = await getExchangeRates();
  const rows = opts.includeInactive
    ? db.select().from(liabilities).all()
    : db.select().from(liabilities).where(eq(liabilities.isActive, true)).all();
  return rows.map(row => withIls(row, rates));
}

// ── Writes ──

export async function createLiability(data: {
  name: string; type: string; currency: string;
  originalAmount: number; currentBalance: number;
  interestRate?: number; startDate?: string; notes?: string;
}) {
  const existing = db.select({ id: liabilities.id }).from(liabilities)
    .where(eq(liabilities.name, data.name)).get();
  if (existing) return { ok: false as const, error: 'Liability name already exists', status: 409 };

  const result = db.insert(liabilities).values({
    name: data.name, type: data.type, currency: data.currency,
    originalAmount: data.originalAmount, currentBalance: data.currentBalance,
    interestRate: data.interestRate, startDate: data.startDate, notes: data.notes,
  }).returning().get();

  const { rates } = await getExchangeRates();
  return { ok: true as const, liability: withIls(result, rates) };
}

export async function updateLiability(id: number, data: {
  name?: string; type?: string; currency?: string;
  originalAmount?: number; currentBalance?: number;
  interestRate?: number | null; startDate?: string | null; notes?: string | null;
}) {
  const existing = db.select().from(liabilities).where(eq(liabilities.id, id)).get();
  if (!existing) return { ok: false as const, error: 'Liability not found', status: 404 };

  if (data.name && data.name !== existing.name) {
    const dup = db.select({ id: liabilities.id }).from(liabilities)
      .where(eq(liabilities.name, data.name)).get();
    if (dup) return { ok: false as const, error: 'Liability name already exists', status: 409 };
  }

  const updateSet: Record<string, unknown> = {};
  if (data.name !== undefined) updateSet.name = data.name;
  if (data.type !== undefined) updateSet.type = data.type;
  if (data.currency !== undefined) updateSet.currency = data.currency;
  if (data.originalAmount !== undefined) updateSet.originalAmount = data.originalAmount;
  if (data.currentBalance !== undefined) updateSet.currentBalance = data.currentBalance;
  if (data.interestRate !== undefined) updateSet.interestRate = data.interestRate;
  if (data.startDate !== undefined) updateSet.startDate = data.startDate;
  if (data.notes !== undefined) updateSet.notes = data.notes;

  if (Object.keys(updateSet).length > 0) {
    db.update(liabilities).set(updateSet).where(eq(liabilities.id, id)).run();
  }

  const updated = db.select().from(liabilities).where(eq(liabilities.id, id)).get();
  if (!updated) return { ok: false as const, error: 'Liability not found after update', status: 404 };
  const { rates } = await getExchangeRates();
  return { ok: true as const, liability: withIls(updated, rates) };
}

export async function deactivateLiability(id: number) {
  const existing = db.select({ id: liabilities.id }).from(liabilities)
    .where(eq(liabilities.id, id)).get();
  if (!existing) return { ok: false as const, error: 'Liability not found', status: 404 };

  db.update(liabilities).set({ isActive: false }).where(eq(liabilities.id, id)).run();
  return { ok: true as const };
}
