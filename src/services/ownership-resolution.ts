import { and, asc, eq, or, sql } from 'drizzle-orm';
import type { db } from '../db/connection.js';
import { accounts, categories, ownershipRules, transactions } from '../db/schema.js';
import type { OwnerTarget, OwnerType } from '../shared/types.js';
export type OwnershipSource = 'manual' | 'rule' | 'category' | 'account' | 'unassigned';
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

export function loadCategoryTargets(database: typeof db): Map<string, OwnerTarget> {
  const rows = database
    .select({
      name: categories.name,
      type: categories.defaultOwnerType,
      memberId: categories.defaultOwnerMemberId,
    })
    .from(categories)
    .where(
      or(
        eq(categories.defaultOwnerType, 'shared'),
        and(
          eq(categories.defaultOwnerType, 'member'),
          sql`${categories.defaultOwnerMemberId} IS NOT NULL`,
        ),
      ),
    )
    .all();

  return new Map(
    rows
      .filter((category) => category.type !== 'member' || category.memberId != null)
      .map((category) => [
        category.name,
        { type: category.type as OwnerType, memberId: category.memberId },
      ]),
  );
}

export function resolveOwnership(
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

export function automaticOwnershipValues(
  row: typeof transactions.$inferSelect,
  database: typeof db,
) {
  if (row.ownerSource === 'manual') return {};
  const account = database.select().from(accounts).where(eq(accounts.id, row.accountId)).get();
  const resolved = resolveOwnership(
    { ...row, accountMemberId: account?.memberId ?? null },
    {
      rules: database
        .select()
        .from(ownershipRules)
        .orderBy(asc(ownershipRules.priority), asc(ownershipRules.id))
        .all(),
      categoryTargets: loadCategoryTargets(database),
    },
  );
  return {
    expenseOwnerType: resolved.target.type,
    expenseOwnerMemberId: resolved.target.type === 'member' ? resolved.target.memberId : null,
    ownerSource: resolved.source,
    ownerConfidence: resolved.confidence,
    ownerReviewReason: null,
  };
}
