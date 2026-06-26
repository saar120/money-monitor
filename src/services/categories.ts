import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { categories, members, transactions } from '../db/schema.js';
import type { OwnerType } from '../shared/types.js';

// ── Reads ──

export function listCategories() {
  return db.select().from(categories).all();
}

export function isCategoryIgnored(categoryName: string | null): boolean {
  if (!categoryName) return false;
  const cat = db
    .select({ ignoredFromStats: categories.ignoredFromStats })
    .from(categories)
    .where(eq(categories.name, categoryName))
    .get();
  return cat?.ignoredFromStats ?? false;
}

// ── Writes ──

function validateDefaultOwner(data: {
  defaultOwnerType?: OwnerType;
  defaultOwnerMemberId?: number | null;
}) {
  if (data.defaultOwnerType === 'member') {
    if (data.defaultOwnerMemberId == null) {
      return {
        ok: false as const,
        error: 'Member default owner requires a member id',
        status: 400,
      };
    }
    const member = db
      .select({ id: members.id })
      .from(members)
      .where(eq(members.id, data.defaultOwnerMemberId))
      .get();
    if (!member) return { ok: false as const, error: 'Member not found', status: 404 };
  }
  return { ok: true as const };
}

function normalizeDefaultOwner<
  T extends { defaultOwnerType?: OwnerType; defaultOwnerMemberId?: number | null },
>(data: T): T {
  if (data.defaultOwnerType && data.defaultOwnerType !== 'member') {
    return { ...data, defaultOwnerMemberId: null };
  }
  return data;
}

export function createCategory(data: {
  name: string;
  label: string;
  color?: string;
  rules?: string;
  defaultOwnerType?: OwnerType;
  defaultOwnerMemberId?: number | null;
}) {
  const ownerValidation = validateDefaultOwner(data);
  if (!ownerValidation.ok) return ownerValidation;

  const existing = db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.name, data.name))
    .get();
  if (existing) return { ok: false as const, error: 'Category name already exists', status: 409 };

  const [created] = db.insert(categories).values(normalizeDefaultOwner(data)).returning().all();
  return { ok: true as const, category: created };
}

export function updateCategory(
  id: number,
  data: {
    label?: string;
    color?: string;
    rules?: string | null;
    ignoredFromStats?: boolean;
    defaultOwnerType?: OwnerType;
    defaultOwnerMemberId?: number | null;
  },
) {
  const existing = db.select().from(categories).where(eq(categories.id, id)).get();
  if (!existing) return { ok: false as const, error: 'Category not found', status: 404 };

  const ownerValidation = validateDefaultOwner(data);
  if (!ownerValidation.ok) return ownerValidation;

  const [updated] = db
    .update(categories)
    .set(normalizeDefaultOwner(data))
    .where(eq(categories.id, id))
    .returning()
    .all();

  if (data.ignoredFromStats !== undefined) {
    db.update(transactions)
      .set({ ignored: data.ignoredFromStats })
      .where(eq(transactions.category, existing.name))
      .run();
  }

  return { ok: true as const, category: updated };
}

export function deleteCategory(id: number) {
  const existing = db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, id))
    .get();
  if (!existing) return { ok: false as const, error: 'Category not found', status: 404 };

  db.delete(categories).where(eq(categories.id, id)).run();
  return { ok: true as const };
}
