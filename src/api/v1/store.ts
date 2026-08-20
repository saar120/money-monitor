import type Database from 'better-sqlite3';
import {
  moneySchema,
  referenceResourceSchema,
  type Money,
  type ReferenceResource,
} from './contract.js';
import { CanonicalApiError } from './errors.js';

export interface ReferenceSeed {
  id?: number;
  title: string;
  amount: Money;
  resourceVersion?: number;
  updatedAt?: string;
}

interface ReferenceRow {
  id: number;
  title: string;
  amount_value: string;
  currency_code: string;
  resource_version: number;
  updated_at: string;
}

interface ReceiptRow {
  request_fingerprint: string;
  outcome_json: string;
}

export interface ReceiptOutcome {
  accepted: true;
  resourceId: number;
  refreshHints: Array<{ domain: string; resourceIds: number[] }>;
}

export interface ReceiptResult {
  outcome: ReceiptOutcome;
  replayed: boolean;
}

export interface ReferenceUpdate {
  id: number;
  expectedVersion: number;
  title?: string;
  amount?: Money;
  updatedAt: string;
}

export class ResourceConflictError extends Error {
  constructor(
    readonly resourceId: number,
    readonly expectedVersion: number,
    readonly currentVersion: number,
  ) {
    super('The resource changed before this request was applied.');
    this.name = 'ResourceConflictError';
  }
}

export class IdempotencyKeyReusedError extends Error {
  constructor(readonly idempotencyKey: string) {
    super('The idempotency key was used for a different request.');
    this.name = 'IdempotencyKeyReusedError';
  }
}

export function stableRequestFingerprint(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)]),
    );
  }
  return value;
}

function toReferenceResource(row: ReferenceRow): ReferenceResource {
  const amount = moneySchema.parse({ value: row.amount_value, currencyCode: row.currency_code });
  return referenceResourceSchema.parse({
    id: row.id,
    title: row.title,
    amount,
    resourceVersion: row.resource_version,
    updatedAt: row.updated_at,
  });
}

function refreshHintsFor(id: number) {
  return [{ domain: 'reference', resourceIds: [id] }];
}

/**
 * SQLite adapter for the foundation resource.  The transaction is the seam:
 * route code supplies an expected version, while this adapter owns atomic
 * compare-and-update/delete and durable receipt replay.
 */
export class CanonicalFoundationStore {
  constructor(private readonly sqlite: Database.Database) {
    this.ensureSchema();
  }

  /**
   * Production connections are migration-managed. This idempotent fallback is
   * intentionally retained only for raw SQLite callers such as the black-box
   * harness and older installs; migration 0024 uses the same compatible DDL
   * and reconciles the seed marker when those tables already exist.
   */
  ensureSchema(): void {
    const resourcesTableExisted = Boolean(
      this.sqlite
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'canonical_reference_resources'",
        )
        .get(),
    );
    const seedStateTableExisted = Boolean(
      this.sqlite
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'canonical_seed_state'",
        )
        .get(),
    );
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS canonical_reference_resources (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        amount_value TEXT NOT NULL,
        currency_code TEXT NOT NULL,
        resource_version INTEGER NOT NULL CHECK (resource_version >= 1),
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS canonical_mutation_receipts (
        client_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_fingerprint TEXT NOT NULL,
        outcome_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (client_id, idempotency_key)
      );

      CREATE TABLE IF NOT EXISTS canonical_seed_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        seeded_at TEXT
      );
    `);
    this.sqlite
      .prepare('INSERT OR IGNORE INTO canonical_seed_state (id, seeded_at) VALUES (1, NULL)')
      .run();

    // Databases created by the first SAA-18 implementation did not have a
    // seed marker. Preserve their deletion history instead of treating an
    // empty resource table as a fresh installation after an upgrade.
    if (resourcesTableExisted && !seedStateTableExisted) {
      const hasResource = Boolean(
        this.sqlite.prepare('SELECT 1 FROM canonical_reference_resources LIMIT 1').get(),
      );
      this.sqlite
        .prepare('UPDATE canonical_seed_state SET seeded_at = ? WHERE id = 1')
        .run(hasResource ? new Date().toISOString() : new Date(0).toISOString());
    }
  }

  /**
   * Seed the reference fixture only once for a database installation. The
   * marker survives resource deletion, so a restart cannot resurrect a
   * resource that a caller intentionally removed.
   */
  seedReferenceOnce(seed: ReferenceSeed): ReferenceResource | null {
    const transaction = this.sqlite.transaction(() => {
      const state = this.sqlite
        .prepare('SELECT seeded_at FROM canonical_seed_state WHERE id = 1')
        .get() as { seeded_at: string | null } | undefined;
      if (!state) {
        this.sqlite
          .prepare('INSERT INTO canonical_seed_state (id, seeded_at) VALUES (1, NULL)')
          .run();
      }
      if (state?.seeded_at) return this.getReference(seed.id ?? 1);

      const resourceId = seed.id ?? 1;
      const existing = this.getReference(resourceId);
      if (!existing) {
        const amount = moneySchema.parse(seed.amount);
        this.sqlite
          .prepare(
            `INSERT INTO canonical_reference_resources
              (id, title, amount_value, currency_code, resource_version, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            resourceId,
            seed.title,
            amount.value,
            amount.currencyCode,
            seed.resourceVersion ?? 1,
            seed.updatedAt ?? new Date(0).toISOString(),
          );
      }
      this.sqlite
        .prepare('UPDATE canonical_seed_state SET seeded_at = ? WHERE id = 1')
        .run(seed.updatedAt ?? new Date().toISOString());
      return this.getReference(resourceId);
    });
    return transaction() as ReferenceResource | null;
  }

  seedReference(seed: ReferenceSeed): ReferenceResource {
    const id = seed.id ?? 1;
    const updatedAt = seed.updatedAt ?? new Date(0).toISOString();
    const resourceVersion = seed.resourceVersion ?? 1;
    const amount = moneySchema.parse(seed.amount);
    this.sqlite
      .prepare(
        `INSERT INTO canonical_reference_resources
          (id, title, amount_value, currency_code, resource_version, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(id, seed.title, amount.value, amount.currencyCode, resourceVersion, updatedAt);

    const resource = this.getReference(id);
    if (!resource) throw new Error('Canonical reference seed was not persisted');
    return resource;
  }

  getReference(id = 1): ReferenceResource | null {
    const row = this.sqlite
      .prepare('SELECT * FROM canonical_reference_resources WHERE id = ?')
      .get(id) as ReferenceRow | undefined;
    return row ? toReferenceResource(row) : null;
  }

  updateReference(update: ReferenceUpdate): ReferenceResource {
    const transaction = this.sqlite.transaction(() => {
      const current = this.sqlite
        .prepare('SELECT * FROM canonical_reference_resources WHERE id = ?')
        .get(update.id) as ReferenceRow | undefined;
      if (!current) throw new CanonicalApiError('resource_not_found');
      if (current.resource_version !== update.expectedVersion) {
        throw new ResourceConflictError(
          update.id,
          update.expectedVersion,
          current.resource_version,
        );
      }

      const amount = update.amount
        ? moneySchema.parse(update.amount)
        : { value: current.amount_value, currencyCode: current.currency_code };
      this.sqlite
        .prepare(
          `UPDATE canonical_reference_resources
             SET title = ?, amount_value = ?, currency_code = ?,
                 resource_version = resource_version + 1, updated_at = ?
           WHERE id = ? AND resource_version = ?`,
        )
        .run(
          update.title ?? current.title,
          amount.value,
          amount.currencyCode,
          update.updatedAt,
          update.id,
          update.expectedVersion,
        );
      const next = this.getReference(update.id);
      if (!next) throw new Error('Updated canonical reference disappeared');
      return next;
    });

    return transaction() as ReferenceResource;
  }

  deleteReference(id: number, expectedVersion: number): number {
    const transaction = this.sqlite.transaction(() => {
      const current = this.sqlite
        .prepare('SELECT resource_version FROM canonical_reference_resources WHERE id = ?')
        .get(id) as { resource_version: number } | undefined;
      if (!current) throw new CanonicalApiError('resource_not_found');
      if (current.resource_version !== expectedVersion) {
        throw new ResourceConflictError(id, expectedVersion, current.resource_version);
      }
      this.sqlite
        .prepare('DELETE FROM canonical_reference_resources WHERE id = ? AND resource_version = ?')
        .run(id, expectedVersion);
      return id;
    });
    return transaction() as number;
  }

  executeRefreshCommand(
    clientId: string,
    idempotencyKey: string,
    resourceId: number,
    requestFingerprint: string,
    createdAt: string,
  ): ReceiptResult {
    const transaction = this.sqlite.transaction(() => {
      const existing = this.sqlite
        .prepare(
          `SELECT request_fingerprint, outcome_json
             FROM canonical_mutation_receipts
            WHERE client_id = ? AND idempotency_key = ?`,
        )
        .get(clientId, idempotencyKey) as ReceiptRow | undefined;
      if (existing) {
        if (existing.request_fingerprint !== requestFingerprint) {
          throw new IdempotencyKeyReusedError(idempotencyKey);
        }
        return {
          outcome: JSON.parse(existing.outcome_json) as ReceiptOutcome,
          replayed: true,
        };
      }

      if (!this.getReference(resourceId)) throw new CanonicalApiError('resource_not_found');
      const outcome: ReceiptOutcome = {
        accepted: true,
        resourceId,
        refreshHints: refreshHintsFor(resourceId),
      };
      this.sqlite
        .prepare(
          `INSERT INTO canonical_mutation_receipts
            (client_id, idempotency_key, request_fingerprint, outcome_json, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(clientId, idempotencyKey, requestFingerprint, JSON.stringify(outcome), createdAt);
      return { outcome, replayed: false };
    });

    return transaction() as ReceiptResult;
  }

  refreshHintsFor(id: number) {
    return refreshHintsFor(id);
  }
}
