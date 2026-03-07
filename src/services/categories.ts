import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { categories, transactions } from '../db/schema.js';

// ── Reads ──

export function listCategories() {
  return db.select().from(categories).all();
}

export function isCategoryIgnored(categoryName: string | null): boolean {
  if (!categoryName) return false;
  const cat = db.select({ ignoredFromStats: categories.ignoredFromStats })
    .from(categories).where(eq(categories.name, categoryName)).get();
  return cat?.ignoredFromStats ?? false;
}

// ── Writes ──

export function createCategory(data: { name: string; label: string; color?: string; rules?: string }) {
  const existing = db.select({ id: categories.id }).from(categories).where(eq(categories.name, data.name)).get();
  if (existing) return { ok: false as const, error: 'Category name already exists', status: 409 };

  const [created] = db.insert(categories).values(data).returning().all();
  return { ok: true as const, category: created };
}

export function updateCategory(id: number, data: { label?: string; color?: string; rules?: string | null; ignoredFromStats?: boolean }) {
  const existing = db.select().from(categories).where(eq(categories.id, id)).get();
  if (!existing) return { ok: false as const, error: 'Category not found', status: 404 };

  const [updated] = db.update(categories).set(data).where(eq(categories.id, id)).returning().all();

  if (data.ignoredFromStats !== undefined) {
    db.update(transactions)
      .set({ ignored: data.ignoredFromStats })
      .where(eq(transactions.category, existing.name))
      .run();
  }

  return { ok: true as const, category: updated };
}

export function deleteCategory(id: number) {
  const existing = db.select({ id: categories.id }).from(categories).where(eq(categories.id, id)).get();
  if (!existing) return { ok: false as const, error: 'Category not found', status: 404 };

  db.delete(categories).where(eq(categories.id, id)).run();
  return { ok: true as const };
}
