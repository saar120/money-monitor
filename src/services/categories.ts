import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { categories, members, transactions } from '../db/schema.js';
import type { OwnerType } from '../shared/types.js';

type CategoryOwnerInput = {
  defaultOwnerType?: OwnerType;
  defaultOwnerMemberId?: number | null;
};

type ExistingCategoryOwner = {
  defaultOwnerType: string;
  defaultOwnerMemberId: number | null;
};

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

function validateMemberOwner(memberId: number) {
  const member = db.select({ id: members.id }).from(members).where(eq(members.id, memberId)).get();
  if (!member) return { ok: false as const, error: 'Member not found', status: 404 };
  return { ok: true as const };
}

function normalizeDefaultOwnerForCreate(data: CategoryOwnerInput) {
  const defaultOwnerType = data.defaultOwnerType ?? 'unassigned';

  if (defaultOwnerType === 'member') {
    if (data.defaultOwnerMemberId == null) {
      return {
        ok: false as const,
        error: 'Member default owner requires a member id',
        status: 400,
      };
    }
    const memberValidation = validateMemberOwner(data.defaultOwnerMemberId);
    if (!memberValidation.ok) return memberValidation;
    return {
      ok: true as const,
      owner: { defaultOwnerType, defaultOwnerMemberId: data.defaultOwnerMemberId },
    };
  }

  if (data.defaultOwnerType === undefined && data.defaultOwnerMemberId !== undefined) {
    return {
      ok: false as const,
      error: 'Default owner type is required when setting a default owner member',
      status: 400,
    };
  }

  return { ok: true as const, owner: { defaultOwnerType, defaultOwnerMemberId: null } };
}

function normalizeDefaultOwnerForUpdate(data: CategoryOwnerInput, existing: ExistingCategoryOwner) {
  const ownerFieldsPresent =
    data.defaultOwnerType !== undefined || data.defaultOwnerMemberId !== undefined;
  if (!ownerFieldsPresent) return { ok: true as const, owner: {}, ownerChanged: false };

  if (data.defaultOwnerType === undefined) {
    if (existing.defaultOwnerType !== 'member') {
      return {
        ok: false as const,
        error: 'Default owner type is required when setting a default owner member',
        status: 400,
      };
    }
    if (data.defaultOwnerMemberId == null) {
      return {
        ok: false as const,
        error: 'Member default owner requires a member id',
        status: 400,
      };
    }
    const memberValidation = validateMemberOwner(data.defaultOwnerMemberId);
    if (!memberValidation.ok) return memberValidation;
    return {
      ok: true as const,
      owner: { defaultOwnerMemberId: data.defaultOwnerMemberId },
      ownerChanged: data.defaultOwnerMemberId !== existing.defaultOwnerMemberId,
    };
  }

  if (data.defaultOwnerType === 'member') {
    if (data.defaultOwnerMemberId == null) {
      return {
        ok: false as const,
        error: 'Member default owner requires a member id',
        status: 400,
      };
    }
    const memberValidation = validateMemberOwner(data.defaultOwnerMemberId);
    if (!memberValidation.ok) return memberValidation;
    return {
      ok: true as const,
      owner: {
        defaultOwnerType: 'member' as const,
        defaultOwnerMemberId: data.defaultOwnerMemberId,
      },
      ownerChanged:
        existing.defaultOwnerType !== 'member' ||
        data.defaultOwnerMemberId !== existing.defaultOwnerMemberId,
    };
  }

  return {
    ok: true as const,
    owner: { defaultOwnerType: data.defaultOwnerType, defaultOwnerMemberId: null },
    ownerChanged:
      existing.defaultOwnerType !== data.defaultOwnerType || existing.defaultOwnerMemberId !== null,
  };
}

export function createCategory(data: {
  name: string;
  label: string;
  color?: string;
  rules?: string;
  defaultOwnerType?: OwnerType;
  defaultOwnerMemberId?: number | null;
}) {
  const ownerValidation = normalizeDefaultOwnerForCreate(data);
  if (!ownerValidation.ok) return ownerValidation;

  const existing = db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.name, data.name))
    .get();
  if (existing) return { ok: false as const, error: 'Category name already exists', status: 409 };

  const [created] = db
    .insert(categories)
    .values({ ...data, ...ownerValidation.owner })
    .returning()
    .all();
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

  const ownerValidation = normalizeDefaultOwnerForUpdate(data, existing);
  if (!ownerValidation.ok) return ownerValidation;

  const [updated] = db
    .update(categories)
    .set({ ...data, ...ownerValidation.owner })
    .where(eq(categories.id, id))
    .returning()
    .all();

  if (data.ignoredFromStats !== undefined) {
    db.update(transactions)
      .set({ ignored: data.ignoredFromStats })
      .where(eq(transactions.category, existing.name))
      .run();
  }

  return { ok: true as const, category: updated, ownerChanged: ownerValidation.ownerChanged };
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
