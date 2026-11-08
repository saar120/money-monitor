import type { Transaction, TransactionCommand, TransactionPatch } from '../api/client';
type Failure = { kind: 'unknown' | 'conflict' | 'rejected'; current?: Transaction };
type Entry = {
  accepted: Transaction;
  pending: TransactionPatch;
  active: TransactionCommand | null;
  failure: Failure | null;
  work: Promise<void> | null;
};
export function createActivityAutosave(options: {
  submit(id: number, command: TransactionCommand): Promise<{ transaction: Transaction }>;
  newId(): string;
  classify(cause: unknown): Failure;
  accepted(previous: Transaction, transaction: Transaction, patch: TransactionPatch): void;
  changed(): void;
}) {
  const entries = new Map<number, Entry>();
  function drain(entry: Entry): Promise<void> {
    if (entry.work) return entry.work;
    const work = Promise.resolve()
      .then(async () => {
        while (!entry.failure && (entry.active || Object.keys(entry.pending).length)) {
          if (!entry.active) {
            if (!entry.accepted.resourceVersion) {
              entry.failure = { kind: 'rejected' };
              options.changed();
              break;
            }
            entry.active = {
              commandId: options.newId(),
              expectedVersion: entry.accepted.resourceVersion,
              patch: entry.pending,
            };
            entry.pending = {};
          }
          const command = entry.active;
          options.changed();
          try {
            const { transaction } = await options.submit(entry.accepted.id, command);
            const previous = entry.accepted;
            entry.accepted = transaction;
            entry.active = null;
            options.accepted(previous, transaction, command.patch);
          } catch (cause) {
            entry.failure = options.classify(cause);
            if (entry.failure.kind !== 'unknown') {
              entry.pending = { ...command.patch, ...entry.pending };
              entry.active = null;
              if (entry.failure.current) entry.accepted = entry.failure.current;
            }
          }
          options.changed();
        }
      })
      .finally(() => {
        if (entry.work === work) entry.work = null;
        options.changed();
      });
    entry.work = work;
    options.changed();
    return work;
  }
  return {
    entries: () => [...entries.values()],
    draft(id: number): TransactionPatch {
      const entry = entries.get(id);
      return entry ? { ...entry.active?.patch, ...entry.pending } : {};
    },
    edit(row: Transaction, patch: TransactionPatch) {
      let entry = entries.get(row.id);
      if (!entry) {
        entry = { accepted: row, pending: {}, active: null, failure: null, work: null };
        entries.set(row.id, entry);
      }
      if (
        !entry.active &&
        !entry.failure &&
        !Object.keys(entry.pending).length &&
        (row.resourceVersion ?? 0) > (entry.accepted.resourceVersion ?? 0)
      )
        entry.accepted = row;
      entry.pending = { ...entry.pending, ...patch };
      options.changed();
      return entry.failure ? Promise.resolve() : drain(entry);
    },
    retry(id: number) {
      const entry = entries.get(id);
      if (!entry) return Promise.resolve();
      entry.failure = null;
      return drain(entry);
    },
  };
}
