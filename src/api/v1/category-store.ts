import type Database from 'better-sqlite3';
import { categoryResourceSchema, type CategoryResource } from './contract.js';
import { CanonicalApiError } from './errors.js';
import {
  IdempotencyKeyReusedError,
  ResourceConflictError,
  stableRequestFingerprint,
} from './store.js';

type CategoryRow = {
  id: number;
  name: string;
  label: string;
  color: string | null;
  rules: string | null;
  default_owner_type: 'member' | 'shared' | 'unassigned';
  default_owner_member_id: number | null;
  ignored_from_stats: number;
  resource_version: number;
  updated_at: string;
};

export type CategoryCreate = Omit<CategoryResource, 'id' | 'resourceVersion' | 'updatedAt'>;
export type CategoryUpdate = Partial<Omit<CategoryCreate, 'name'>> & {
  id: number;
  expectedVersion: number;
};

function resource(row: CategoryRow): CategoryResource {
  return categoryResourceSchema.parse({
    id: row.id,
    name: row.name,
    label: row.label,
    color: row.color,
    rules: row.rules,
    defaultOwnerType: row.default_owner_type,
    defaultOwnerMemberId: row.default_owner_member_id,
    ignoredFromStats: Boolean(row.ignored_from_stats),
    resourceVersion: row.resource_version,
    updatedAt: row.updated_at.endsWith('Z')
      ? row.updated_at
      : `${row.updated_at.replace(' ', 'T')}Z`,
  });
}

export class CanonicalCategoryStore {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly onOwnerChanged: (categoryName: string) => void = () => undefined,
  ) {}

  list(): CategoryResource[] {
    return (
      this.sqlite
        .prepare('SELECT * FROM categories ORDER BY label COLLATE NOCASE, id')
        .all() as CategoryRow[]
    ).map(resource);
  }

  ownerMembers(): Array<{ id: number; name: string }> {
    return this.sqlite
      .prepare('SELECT id, name FROM members WHERE is_active = 1 ORDER BY name COLLATE NOCASE, id')
      .all() as Array<{ id: number; name: string }>;
  }

  get(id: number): CategoryResource | null {
    const row = this.sqlite.prepare('SELECT * FROM categories WHERE id = ?').get(id) as
      | CategoryRow
      | undefined;
    return row ? resource(row) : null;
  }

  private validateOwner(type: CategoryCreate['defaultOwnerType'], memberId: number | null): void {
    if (type === 'member') {
      if (!memberId || !this.sqlite.prepare('SELECT 1 FROM members WHERE id = ?').get(memberId)) {
        throw new CanonicalApiError('validation_error');
      }
    } else if (memberId !== null) throw new CanonicalApiError('validation_error');
  }

  create(clientId: string, idempotencyKey: string, input: CategoryCreate, now: string) {
    this.validateOwner(input.defaultOwnerType, input.defaultOwnerMemberId);
    const fingerprint = stableRequestFingerprint(input);
    return this.sqlite.transaction(() => {
      const prior = this.sqlite
        .prepare(
          'SELECT request_fingerprint, outcome_json FROM canonical_mutation_receipts WHERE client_id = ? AND idempotency_key = ?',
        )
        .get(clientId, idempotencyKey) as
        | { request_fingerprint: string; outcome_json: string }
        | undefined;
      if (prior) {
        if (prior.request_fingerprint !== fingerprint)
          throw new IdempotencyKeyReusedError(idempotencyKey);
        const stored = categoryResourceSchema.parse(JSON.parse(prior.outcome_json));
        return { category: stored, replayed: true };
      }
      let inserted;
      try {
        inserted = this.sqlite
          .prepare(
            `INSERT INTO categories
             (name, label, color, rules, default_owner_type, default_owner_member_id,
              ignored_from_stats, resource_version, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?) RETURNING *`,
          )
          .get(
            input.name,
            input.label,
            input.color,
            input.rules,
            input.defaultOwnerType,
            input.defaultOwnerMemberId,
            input.ignoredFromStats ? 1 : 0,
            now,
          ) as CategoryRow;
      } catch (error) {
        if (error instanceof Error && error.message.includes('UNIQUE'))
          throw new CanonicalApiError('resource_conflict');
        throw error;
      }
      const category = resource(inserted);
      this.sqlite
        .prepare(
          `INSERT INTO canonical_mutation_receipts
          (client_id, idempotency_key, request_fingerprint, outcome_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        )
        .run(clientId, idempotencyKey, fingerprint, JSON.stringify(category), now);
      return { category, replayed: false };
    })();
  }

  update(input: CategoryUpdate, now: string): CategoryResource {
    return this.sqlite.transaction(() => {
      const current = this.get(input.id);
      if (!current) throw new CanonicalApiError('resource_not_found');
      if (current.resourceVersion !== input.expectedVersion) {
        throw new ResourceConflictError(input.id, input.expectedVersion, current.resourceVersion);
      }
      const ownerType = input.defaultOwnerType ?? current.defaultOwnerType;
      const ownerMemberId =
        input.defaultOwnerMemberId === undefined
          ? input.defaultOwnerType && input.defaultOwnerType !== 'member'
            ? null
            : current.defaultOwnerMemberId
          : input.defaultOwnerMemberId;
      this.validateOwner(ownerType, ownerMemberId);
      const ignored = input.ignoredFromStats ?? current.ignoredFromStats;
      const changed = this.sqlite
        .prepare(
          `UPDATE categories SET label = ?, color = ?, rules = ?, default_owner_type = ?,
           default_owner_member_id = ?, ignored_from_stats = ?, resource_version = resource_version + 1,
           updated_at = ? WHERE id = ? AND resource_version = ?`,
        )
        .run(
          input.label ?? current.label,
          input.color === undefined ? current.color : input.color,
          input.rules === undefined ? current.rules : input.rules,
          ownerType,
          ownerMemberId,
          ignored ? 1 : 0,
          now,
          input.id,
          input.expectedVersion,
        );
      if (changed.changes !== 1)
        throw new ResourceConflictError(
          input.id,
          input.expectedVersion,
          this.get(input.id)?.resourceVersion ?? input.expectedVersion,
        );
      if (input.ignoredFromStats !== undefined) {
        this.sqlite
          .prepare('UPDATE transactions SET ignored = ? WHERE category = ?')
          .run(ignored ? 1 : 0, current.name);
      }
      if (
        ownerType !== current.defaultOwnerType ||
        ownerMemberId !== current.defaultOwnerMemberId
      ) {
        this.onOwnerChanged(current.name);
      }
      return this.get(input.id)!;
    })();
  }

  delete(id: number, expectedVersion: number): void {
    const current = this.get(id);
    if (!current) throw new CanonicalApiError('resource_not_found');
    if (current.resourceVersion !== expectedVersion)
      throw new ResourceConflictError(id, expectedVersion, current.resourceVersion);
    const result = this.sqlite
      .prepare('DELETE FROM categories WHERE id = ? AND resource_version = ?')
      .run(id, expectedVersion);
    if (result.changes !== 1)
      throw new ResourceConflictError(
        id,
        expectedVersion,
        this.get(id)?.resourceVersion ?? expectedVersion,
      );
  }
}
