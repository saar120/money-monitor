import { computed, onScopeDispose, shallowRef } from 'vue';

type Resource<T> =
  | { status: 'idle'; data: null; error: null; scope: string }
  | { status: 'loading' | 'refreshing'; data: T | null; error: null; scope: string }
  | { status: 'ready'; data: T; error: null; scope: string }
  | { status: 'failed'; data: T | null; error: string; scope: string };

export function useApi<T>(fetcher: () => Promise<T>, scope: () => string = () => '') {
  const state = shallowRef<Resource<T>>({
    status: 'idle',
    data: null,
    error: null,
    scope: scope(),
  });
  let generation = 0;
  onScopeDispose(() => {
    generation++;
  });
  async function execute() {
    const request = ++generation;
    const key = scope();
    const retained = state.value.scope === key ? state.value.data : null;
    state.value = {
      status: retained === null ? 'loading' : 'refreshing',
      data: retained,
      error: null,
      scope: key,
    };
    try {
      const data = await fetcher();
      if (request === generation && key === scope())
        state.value = { status: 'ready', data, error: null, scope: key };
    } catch (cause) {
      if (request === generation && key === scope())
        state.value = {
          status: 'failed',
          data: retained,
          error: cause instanceof Error ? cause.message : 'Unknown error',
          scope: key,
        };
    }
  }
  return {
    state,
    accept(data: T) {
      generation++;
      state.value = { status: 'ready', data, error: null, scope: scope() };
    },
    data: computed(() => (state.value.scope === scope() ? state.value.data : null)),
    loading: computed(() => ['loading', 'refreshing'].includes(state.value.status)),
    error: computed(() => state.value.error),
    execute,
  };
}
