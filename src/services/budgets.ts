import { and, eq, gte, lte, sql, inArray } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { budgets, transactions } from '../db/schema.js';
import { todayInIsrael } from '../shared/dates.js';

const round2 = (n: number): number => Math.round(n * 100) / 100;

// ── Helpers ──

function parseCategoryNames(raw: string): string[] {
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

function toBudgetResponse(row: typeof budgets.$inferSelect) {
  return {
    ...row,
    categoryNames: parseCategoryNames(row.categoryNames),
  };
}

// ── Reads ──

export function listBudgets(includeInactive = false) {
  const rows = includeInactive
    ? db.select().from(budgets).all()
    : db.select().from(budgets).where(eq(budgets.isActive, true)).all();
  return rows.map(toBudgetResponse);
}

export function getBudget(id: number) {
  const row = db.select().from(budgets).where(eq(budgets.id, id)).get();
  if (!row) return null;
  return toBudgetResponse(row);
}

// ── Writes ──

export function createBudget(data: {
  name: string;
  amount: number;
  period?: string;
  categoryNames: string[];
  alertThreshold?: number;
  alertEnabled?: boolean;
  color?: string;
}) {
  const [created] = db
    .insert(budgets)
    .values({
      name: data.name,
      amount: data.amount,
      period: data.period ?? 'monthly',
      categoryNames: JSON.stringify(data.categoryNames),
      alertThreshold: data.alertThreshold ?? 80,
      alertEnabled: data.alertEnabled ?? true,
      color: data.color,
    })
    .returning()
    .all();
  return { ok: true as const, budget: toBudgetResponse(created) };
}

export function updateBudget(
  id: number,
  data: {
    name?: string;
    amount?: number;
    period?: string;
    categoryNames?: string[];
    alertThreshold?: number;
    alertEnabled?: boolean;
    color?: string | null;
    isActive?: boolean;
  },
) {
  const existing = db.select().from(budgets).where(eq(budgets.id, id)).get();
  if (!existing) return { ok: false as const, error: 'Budget not found', status: 404 };

  const updates: Record<string, unknown> = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.amount !== undefined) updates.amount = data.amount;
  if (data.period !== undefined) updates.period = data.period;
  if (data.categoryNames !== undefined) updates.categoryNames = JSON.stringify(data.categoryNames);
  if (data.alertThreshold !== undefined) updates.alertThreshold = data.alertThreshold;
  if (data.alertEnabled !== undefined) updates.alertEnabled = data.alertEnabled;
  if (data.color !== undefined) updates.color = data.color;
  if (data.isActive !== undefined) updates.isActive = data.isActive;

  const [updated] = db.update(budgets).set(updates).where(eq(budgets.id, id)).returning().all();
  return { ok: true as const, budget: toBudgetResponse(updated) };
}

export function deleteBudget(id: number) {
  const existing = db.select({ id: budgets.id }).from(budgets).where(eq(budgets.id, id)).get();
  if (!existing) return { ok: false as const, error: 'Budget not found', status: 404 };
  db.delete(budgets).where(eq(budgets.id, id)).run();
  return { ok: true as const };
}

// ── Progress ──

function getBudgetDateRange(period: string): { startDate: string; endDate: string } {
  const today = todayInIsrael();
  const [y, m] = today.split('-').map(Number);

  if (period === 'yearly') {
    return { startDate: `${y}-01-01`, endDate: today };
  }
  // monthly
  return { startDate: `${y}-${String(m).padStart(2, '0')}-01`, endDate: today };
}

function getCurrentMonthNumber(): number {
  const today = todayInIsrael();
  return parseInt(today.split('-')[1], 10);
}

export function getBudgetProgress(budgetId: number, monthlyView = false) {
  const budget = getBudget(budgetId);
  if (!budget) return null;

  const { startDate, endDate } = getBudgetDateRange(budget.period);
  const categoryNames = budget.categoryNames;

  if (categoryNames.length === 0) {
    return buildProgressResult(budget, 0, [], startDate, endDate, monthlyView);
  }

  // Total spent (expenses only — negative chargedAmount)
  const spentRow = db
    .select({
      total: sql<number>`SUM(ABS(${transactions.chargedAmount}))`.as('total'),
    })
    .from(transactions)
    .where(
      and(
        inArray(transactions.category, categoryNames),
        gte(transactions.date, startDate),
        lte(transactions.date, endDate),
        eq(transactions.ignored, false),
        sql`${transactions.chargedAmount} < 0`,
      ),
    )
    .get();

  const spent = spentRow?.total ?? 0;

  // Monthly breakdown for yearly budgets
  let monthlyBreakdown: Array<{ month: string; spent: number }> = [];
  if (budget.period === 'yearly' && monthlyView) {
    monthlyBreakdown = db
      .select({
        month: sql<string>`strftime('%Y-%m', ${transactions.date})`.as('month'),
        spent: sql<number>`SUM(ABS(${transactions.chargedAmount}))`.as('spent'),
      })
      .from(transactions)
      .where(
        and(
          inArray(transactions.category, categoryNames),
          gte(transactions.date, startDate),
          lte(transactions.date, endDate),
          eq(transactions.ignored, false),
          sql`${transactions.chargedAmount} < 0`,
        ),
      )
      .groupBy(sql`strftime('%Y-%m', ${transactions.date})`)
      .orderBy(sql`month asc`)
      .all();
  }

  return buildProgressResult(budget, spent, monthlyBreakdown, startDate, endDate, monthlyView);
}

function buildProgressResult(
  budget: ReturnType<typeof toBudgetResponse>,
  spent: number,
  monthlyBreakdown: Array<{ month: string; spent: number }>,
  startDate: string,
  endDate: string,
  monthlyView: boolean,
) {
  const percentage = budget.amount > 0 ? round2((spent / budget.amount) * 100) : 0;
  const remaining = round2(budget.amount - spent);
  const isOverBudget = spent > budget.amount;
  const isAlertTriggered = budget.alertEnabled && percentage >= budget.alertThreshold;

  const result: Record<string, unknown> = {
    budget,
    spent: round2(spent),
    remaining,
    percentage,
    isOverBudget,
    isAlertTriggered,
    period: { startDate, endDate },
  };

  if (budget.period === 'yearly' && monthlyView) {
    const monthlyBudget = round2(budget.amount / 12);
    const currentMonth = getCurrentMonthNumber();
    const expectedSpentByNow = round2(monthlyBudget * currentMonth);

    result.monthlyView = {
      monthlyBudget,
      currentMonth,
      expectedSpentByNow,
      isOnTrack: spent <= expectedSpentByNow,
      breakdown: monthlyBreakdown.map((m) => ({
        ...m,
        spent: round2(m.spent),
        budgeted: monthlyBudget,
        percentage: round2((m.spent / monthlyBudget) * 100),
      })),
    };
  }

  return result;
}

export function getAllBudgetProgress(monthlyView = false) {
  const allBudgets = listBudgets(false);
  return allBudgets.map((b) => getBudgetProgress(b.id, monthlyView)).filter(Boolean);
}
