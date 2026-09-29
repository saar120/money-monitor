// Cache both the pending request and its resolved value so a destination can
// render the data already loaded by its parent on its very first frame.
export function createHistoryCache<T>(fetch: (count: number) => Promise<T[]>) {
  const entries = new Map<number, { data?: T[]; request: Promise<T[]> }>();
  return {
    peek: (count = 12) => entries.get(count)?.data,
    load(count = 12): Promise<T[]> {
      const cached = entries.get(count);
      if (cached) return cached.request;
      const entry = {
        data: undefined as T[] | undefined,
        request: Promise.resolve().then(() => fetch(count)),
      };
      entry.request = entry.request.then(
        (data) => {
          entry.data = data;
          return data;
        },
        (error) => {
          entries.delete(count);
          throw error;
        },
      );
      entries.set(count, entry);
      return entry.request;
    },
  };
}
