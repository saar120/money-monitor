import type { HomeData } from './fixtures';

const DAY = 86_400_000;
export type SavedView = { home: HomeData; status: 'saved-view' | 'stale-saved-view' };
export interface SavedViewStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  remove(): Promise<void>;
  encrypt(value: string): Promise<string>;
  decrypt(value: string): Promise<string>;
}
function validHome(value: unknown): value is HomeData {
  if (!value || typeof value !== 'object') return false;
  const home = value as HomeData;
  const strings = (...values: unknown[]) => values.every((v) => typeof v === 'string');
  const numbers = (...values: unknown[]) =>
    values.every((v) => typeof v === 'number' && Number.isFinite(v));
  const optionalNumbers = (...values: unknown[]) => values.every((v) => v === null || numbers(v));
  const rows = (values: unknown, valid: (row: Record<string, unknown>) => boolean) =>
    Array.isArray(values) && values.every((v) => v !== null && typeof v === 'object' && valid(v));
  return (
    strings(
      home.currentDate,
      home.monthKey,
      home.month,
      home.currencyCode,
      home.budgetStatus,
      home.budgetNote,
    ) &&
    /^\d{4}-\d{2}-\d{2}$/.test(home.currentDate) &&
    /^\d{4}-\d{2}$/.test(home.monthKey) &&
    numbers(home.spent, home.income, home.previousSpent, home.netWorth, home.reviewCount) &&
    optionalNumbers(
      home.spendingVsIncomePercent,
      home.available,
      home.budget,
      home.netWorthChange,
      home.assets,
      home.liabilities,
    ) &&
    Array.isArray(home.availableMonths) &&
    home.availableMonths.every((v) => typeof v === 'string' && /^\d{4}-\d{2}$/.test(v)) &&
    rows(home.accounts, (v) => strings(v.id, v.label)) &&
    rows(
      home.categories,
      (v) => strings(v.name, v.color) && numbers(v.spent, v.previous) && optionalNumbers(v.budget),
    ) &&
    rows(home.trend, (v) => numbers(v.day, v.current, v.previous)) &&
    rows(
      home.budgets,
      (v) =>
        strings(v.name) &&
        ['on_track', 'watch', 'over_budget'].includes(String(v.status)) &&
        numbers(v.spent, v.limit, v.remaining, v.usedPercent, v.elapsedPercent) &&
        (v.categoryNames === null ||
          (Array.isArray(v.categoryNames) &&
            v.categoryNames.every((name) => typeof name === 'string'))),
    ) &&
    rows(
      home.merchants,
      (v) => strings(v.name, v.category) && numbers(v.current, v.previous, v.count),
    ) &&
    rows(
      home.freshness,
      (v) => strings(v.account, v.detail) && ['fresh', 'aging', 'stale'].includes(String(v.state)),
    ) &&
    rows(home.netWorthHistory, (v) => strings(v.date) && numbers(v.total)) &&
    (home.sinceLastVisit === null ||
      (typeof home.sinceLastVisit === 'object' &&
        home.sinceLastVisit !== undefined &&
        numbers(home.sinceLastVisit.transactions, home.sinceLastVisit.spent)))
  );
}

export function savedViewState(
  home: HomeData,
  now: number,
  highestObservedAt: number,
): SavedView['status'] | null {
  const snapshot = home.snapshot;
  if (
    snapshot?.complete !== true ||
    snapshot.cacheable !== true ||
    typeof snapshot.id !== 'string' ||
    !snapshot.id ||
    !Number.isFinite(now) ||
    now < highestObservedAt
  )
    return null;
  const calculated = Date.parse(snapshot.calculatedAt);
  const stale = Date.parse(snapshot.staleAt);
  const remove = Date.parse(snapshot.deleteAfter);
  // The authenticated server may shorten retention, never extend the approved bounds.
  if (
    ![calculated, stale, remove].every(Number.isFinite) ||
    calculated > now ||
    stale < calculated ||
    remove <= stale ||
    stale > calculated + DAY ||
    remove > calculated + 7 * DAY ||
    now >= remove
  )
    return null;
  return now >= stale ? 'stale-saved-view' : 'saved-view';
}
export function createSavedViewStore(storage: SavedViewStorage) {
  let generation = 0;
  let writes: Promise<unknown> = Promise.resolve();
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = writes.catch(() => {}).then(operation);
    writes = next;
    return next;
  }
  return {
    purge() {
      generation++;
      return serial(() => storage.remove());
    },
    save(identity: string, home: HomeData, now = Date.now()) {
      const scope = generation;
      if (!validHome(home) || !savedViewState(home, now, now)) return Promise.resolve();
      return serial(async () => {
        if (scope !== generation) return;
        const ciphertext = await storage.encrypt(
          JSON.stringify({ version: 1, identity, home, highestObservedAt: now }),
        );
        if (scope === generation) await storage.write(ciphertext);
      });
    },
    load(identity: string, now = Date.now()): Promise<SavedView | null> {
      const scope = generation;
      return serial(async () => {
        try {
          const ciphertext = await storage.read();
          if (!ciphertext || scope !== generation) return null;
          const value: unknown = JSON.parse(await storage.decrypt(ciphertext));
          if (!value || typeof value !== 'object') throw new Error('Invalid Saved View');
          const entry = value as {
            version: number;
            identity: string;
            home: unknown;
            highestObservedAt: number;
          };
          if (
            entry.version !== 1 ||
            entry.identity !== identity ||
            !validHome(entry.home) ||
            !Number.isFinite(entry.highestObservedAt)
          )
            throw new Error('Invalid Saved View');
          const status = savedViewState(entry.home, now, entry.highestObservedAt);
          if (!status || scope !== generation) throw new Error('Unavailable Saved View');
          const updated = await storage.encrypt(
            JSON.stringify({ ...entry, highestObservedAt: now }),
          );
          if (scope !== generation) return null;
          await storage.write(updated);
          return { home: entry.home, status };
        } catch {
          await storage.remove();
          return null;
        }
      });
    },
  };
}
