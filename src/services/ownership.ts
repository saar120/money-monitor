import { and, asc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { accounts, categories, members, ownershipRules, transactions } from '../db/schema.js';
import type { OwnerTarget, OwnerType } from '../shared/types.js';

export type OwnershipSource = 'manual' | 'rule' | 'category' | 'account' | 'unassigned';

export interface OwnerFilter {
  ownerType?: OwnerType | 'all';
  ownerMemberId?: number;
}

export interface OwnershipRuleInput {
  name: string;
  priority?: number;
  enabled?: boolean;
  accountId?: number | null;
  accountMemberId?: number | null;
  categoryName?: string | null;
  descriptionContains?: string | null;
  minAmount?: number | null;
  maxAmount?: number | null;
  targetOwnerType: OwnerType;
  targetOwnerMemberId?: number | null;
}

interface TransactionForOwnership {
  id: number;
  accountId: number;
  accountMemberId: number | null;
  category: string | null;
  description: string;
  chargedAmount: number;
  ownerSource: string;
}

interface OwnershipResolutionContext {
  rules: (typeof ownershipRules.$inferSelect)[];
  categoryTargets: Map<string, OwnerTarget>;
}

const OWNER_TYPES = new Set<OwnerType>(['member', 'shared', 'unassigned']);

export function validateOwnerTarget(target: OwnerTarget) {
  if (!OWNER_TYPES.has(target.type)) {
    return { ok: false as const, error: 'Invalid owner type', status: 400 };
  }
  if (target.type !== 'member') {
    return { ok: true as const, target: { type: target.type, memberId: null } };
  }
  if (target.memberId == null) {
    return { ok: false as const, error: 'Member owner requires memberId', status: 400 };
  }
  const member = db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.id, target.memberId), eq(members.isActive, true)))
    .get();
  if (!member) return { ok: false as const, error: 'Member not found', status: 404 };
  return { ok: true as const, target: { type: 'member' as const, memberId: target.memberId } };
}

export function ownerFilterConditions(filter: OwnerFilter): SQL[] {
  if (!filter.ownerType || filter.ownerType === 'all') return [];
  if (filter.ownerType === 'member') {
    return [
      eq(transactions.expenseOwnerType, 'member'),
      filter.ownerMemberId != null
        ? eq(transactions.expenseOwnerMemberId, filter.ownerMemberId)
        : sql`1 = 0`,
    ];
  }
  return [eq(transactions.expenseOwnerType, filter.ownerType)];
}

export function listOwnershipRules() {
  return db
    .select()
    .from(ownershipRules)
    .orderBy(asc(ownershipRules.priority), asc(ownershipRules.id))
    .all();
}

export function createOwnershipRule(input: OwnershipRuleInput) {
  const target = validateOwnerTarget({
    type: input.targetOwnerType,
    memberId: input.targetOwnerMemberId,
  });
  if (!target.ok) return target;

  const [created] = db
    .insert(ownershipRules)
    .values({
      name: input.name,
      priority: input.priority ?? 100,
      enabled: input.enabled ?? true,
      accountId: input.accountId ?? null,
      accountMemberId: input.accountMemberId ?? null,
      categoryName: input.categoryName ?? null,
      descriptionContains: input.descriptionContains ?? null,
      minAmount: input.minAmount ?? null,
      maxAmount: input.maxAmount ?? null,
      targetOwnerType: target.target.type,
      targetOwnerMemberId: target.target.memberId,
    })
    .returning()
    .all();
  return { ok: true as const, rule: created };
}

export function updateOwnershipRule(id: number, input: Partial<OwnershipRuleInput>) {
  const existing = db.select().from(ownershipRules).where(eq(ownershipRules.id, id)).get();
  if (!existing) return { ok: false as const, error: 'Ownership rule not found', status: 404 };

  const nextOwnerType = input.targetOwnerType ?? (existing.targetOwnerType as OwnerType);
  const nextOwnerMemberId =
    input.targetOwnerMemberId !== undefined
      ? input.targetOwnerMemberId
      : existing.targetOwnerMemberId;
  const target = validateOwnerTarget({ type: nextOwnerType, memberId: nextOwnerMemberId });
  if (!target.ok) return target;

  const updates: Record<string, unknown> = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.priority !== undefined) updates.priority = input.priority;
  if (input.enabled !== undefined) updates.enabled = input.enabled;
  if (input.accountId !== undefined) updates.accountId = input.accountId;
  if (input.accountMemberId !== undefined) updates.accountMemberId = input.accountMemberId;
  if (input.categoryName !== undefined) updates.categoryName = input.categoryName;
  if (input.descriptionContains !== undefined)
    updates.descriptionContains = input.descriptionContains;
  if (input.minAmount !== undefined) updates.minAmount = input.minAmount;
  if (input.maxAmount !== undefined) updates.maxAmount = input.maxAmount;
  if (input.targetOwnerType !== undefined || input.targetOwnerMemberId !== undefined) {
    updates.targetOwnerType = target.target.type;
    updates.targetOwnerMemberId = target.target.memberId;
  }

  const [updated] = db
    .update(ownershipRules)
    .set(updates)
    .where(eq(ownershipRules.id, id))
    .returning()
    .all();
  return { ok: true as const, rule: updated };
}

export function deleteOwnershipRule(id: number) {
  const existing = db
    .select({ id: ownershipRules.id })
    .from(ownershipRules)
    .where(eq(ownershipRules.id, id))
    .get();
  if (!existing) return { ok: false as const, error: 'Ownership rule not found', status: 404 };
  db.delete(ownershipRules).where(eq(ownershipRules.id, id)).run();
  return { ok: true as const };
}

function matchesRule(
  rule: typeof ownershipRules.$inferSelect,
  tx: TransactionForOwnership,
): boolean {
  if (!rule.enabled) return false;
  if (rule.accountId != null && rule.accountId !== tx.accountId) return false;
  if (rule.accountMemberId != null && rule.accountMemberId !== tx.accountMemberId) return false;
  if (rule.categoryName != null && rule.categoryName !== tx.category) return false;
  if (
    rule.descriptionContains &&
    !tx.description.toLocaleLowerCase().includes(rule.descriptionContains.toLocaleLowerCase())
  ) {
    return false;
  }
  if (rule.minAmount != null && tx.chargedAmount < rule.minAmount) return false;
  if (rule.maxAmount != null && tx.chargedAmount > rule.maxAmount) return false;
  return true;
}

function targetFromRule(rule: typeof ownershipRules.$inferSelect): OwnerTarget {
  return {
    type: rule.targetOwnerType as OwnerType,
    memberId: rule.targetOwnerMemberId,
  };
}

function loadCategoryTargets(): Map<string, OwnerTarget> {
  const rows = db
    .select({
      name: categories.name,
      type: categories.defaultOwnerType,
      memberId: categories.defaultOwnerMemberId,
    })
    .from(categories)
    .where(sql`${categories.defaultOwnerType} != 'unassigned'`)
    .all();

  return new Map(
    rows.map((category) => [
      category.name,
      { type: category.type as OwnerType, memberId: category.memberId },
    ]),
  );
}

function resolveOwnership(
  tx: TransactionForOwnership,
  context: OwnershipResolutionContext,
): {
  target: OwnerTarget;
  source: OwnershipSource;
  confidence: number | null;
} {
  const rule = context.rules.find((candidate) => matchesRule(candidate, tx));
  if (rule) return { target: targetFromRule(rule), source: 'rule', confidence: 1 };

  const categoryTarget = tx.category ? context.categoryTargets.get(tx.category) : null;
  if (categoryTarget) return { target: categoryTarget, source: 'category', confidence: 1 };

  if (tx.accountMemberId != null) {
    return {
      target: { type: 'member', memberId: tx.accountMemberId },
      source: 'account',
      confidence: 1,
    };
  }

  return { target: { type: 'unassigned', memberId: null }, source: 'unassigned', confidence: null };
}

export function setTransactionOwner(id: number, target: OwnerTarget) {
  const valid = validateOwnerTarget(target);
  if (!valid.ok) return valid;

  const [updated] = db
    .update(transactions)
    .set({
      expenseOwnerType: valid.target.type,
      expenseOwnerMemberId: valid.target.memberId,
      ownerSource: 'manual',
      ownerConfidence: 1,
      ownerReviewReason: null,
    })
    .where(eq(transactions.id, id))
    .returning()
    .all();
  if (!updated) return { ok: false as const, error: 'Transaction not found', status: 404 };
  return { ok: true as const, transaction: updated };
}

function transactionOwnershipRows(
  ids?: number[],
  startDate?: string,
  endDate?: string,
  accountId?: number,
  categoryName?: string,
) {
  const conditions: SQL[] = [];
  if (ids && ids.length > 0) conditions.push(or(...ids.map((id) => eq(transactions.id, id)))!);
  if (accountId != null) conditions.push(eq(transactions.accountId, accountId));
  if (categoryName != null) conditions.push(eq(transactions.category, categoryName));
  if (startDate) conditions.push(gte(transactions.date, startDate));
  if (endDate) conditions.push(lte(transactions.date, endDate));

  return db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      accountMemberId: accounts.memberId,
      category: transactions.category,
      description: transactions.description,
      chargedAmount: transactions.chargedAmount,
      ownerSource: transactions.ownerSource,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .all();
}

export function applyOwnership(
  input: {
    ids?: number[];
    accountId?: number;
    categoryName?: string;
    startDate?: string;
    endDate?: string;
    force?: boolean;
  } = {},
) {
  const rows = transactionOwnershipRows(
    input.ids,
    input.startDate,
    input.endDate,
    input.accountId,
    input.categoryName,
  );
  const context: OwnershipResolutionContext = {
    rules: listOwnershipRules(),
    categoryTargets: loadCategoryTargets(),
  };
  let updated = 0;
  for (const row of rows) {
    if (!input.force && row.ownerSource === 'manual') continue;
    const resolved = resolveOwnership(row, context);
    db.update(transactions)
      .set({
        expenseOwnerType: resolved.target.type,
        expenseOwnerMemberId: resolved.target.type === 'member' ? resolved.target.memberId : null,
        ownerSource: resolved.source,
        ownerConfidence: resolved.confidence,
        ownerReviewReason: null,
      })
      .where(eq(transactions.id, row.id))
      .run();
    updated++;
  }
  return { updated };
}

export function ownershipConditionForRuleCandidates() {
  return or(isNull(transactions.ownerSource), eq(transactions.ownerSource, 'unassigned'));
}
