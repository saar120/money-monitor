// Pending requests are shared; invalidation retires the scope, including callbacks.
export function createHistoryCache<T>(fetch: (count: number) => Promise<T[]>, limit = 24) {
  type Entry = { data?: T[]; request: Promise<T[]> };
  const entries = new Map<number, Entry>();
  let generation = 0;
  return {
    peek: (count = 12) => entries.get(count)?.data,
    invalidate() {
      generation++;
      entries.clear();
    },
    load(count = 12): Promise<T[]> {
      const cached = entries.get(count);
      if (cached) return cached.request;
      const scope = generation;
      const entry: Entry = { request: Promise.resolve().then(() => fetch(count)) };
      entry.request = entry.request.then(
        (data) => {
          if (scope === generation && entries.get(count) === entry) entry.data = data;
          return data;
        },
        (error) => {
          if (scope === generation && entries.get(count) === entry) entries.delete(count);
          throw error;
        },
      );
      entries.set(count, entry);
      while (entries.size > limit) entries.delete(entries.keys().next().value!);
      return entry.request;
    },
  };
}
