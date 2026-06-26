import { and, count, eq, ne } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { accounts, members } from '../db/schema.js';

export function listMembers(includeInactive = false) {
  return includeInactive
    ? db.select().from(members).all()
    : db.select().from(members).where(eq(members.isActive, true)).all();
}

export function getDefaultMemberId(): number | null {
  const existing = db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.isActive, true))
    .orderBy(members.id)
    .get();
  if (existing) return existing.id;

  const [created] = db.insert(members).values({ name: 'Member 1' }).returning().all();
  return created?.id ?? null;
}

export function createMember(data: { name: string }) {
  const [created] = db.insert(members).values({ name: data.name }).returning().all();
  return { ok: true as const, member: created };
}

export function updateMember(id: number, data: { name?: string; isActive?: boolean }) {
  const existing = db.select().from(members).where(eq(members.id, id)).get();
  if (!existing) return { ok: false as const, error: 'Member not found', status: 404 };

  if (data.isActive === false) {
    const [{ total }] = db
      .select({ total: count() })
      .from(members)
      .where(and(eq(members.isActive, true), ne(members.id, id)))
      .all();
    if (total === 0) {
      return {
        ok: false as const,
        error: 'At least one active member is required',
        status: 400,
      };
    }

    const accountUsingMember = db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.memberId, id))
      .get();
    if (accountUsingMember) {
      return {
        ok: false as const,
        error: 'Move accounts to another member before deactivating this member',
        status: 409,
      };
    }
  }

  const [updated] = db.update(members).set(data).where(eq(members.id, id)).returning().all();
  return { ok: true as const, member: updated };
}
