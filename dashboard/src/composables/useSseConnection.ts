import { computed, ref, onUnmounted } from 'vue';
import { createScrapeEventSource } from '../api/client';
export type SseHandlers = Record<string, (data: Record<string, unknown>) => void>;
export function useSseConnection(handlers: SseHandlers) {
  const state = ref<'disconnected' | 'connecting' | 'open' | 'reconnect-wait' | 'disposed'>(
    'disconnected',
  );
  let source: ReturnType<typeof createScrapeEventSource> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;
  function disconnect() {
    generation++;
    if (timer) clearTimeout(timer);
    timer = null;
    source?.close();
    source = null;
    if (state.value !== 'disposed') state.value = 'disconnected';
  }
  function connect() {
    if (state.value === 'disposed') return;
    disconnect();
    const attempt = generation;
    state.value = 'connecting';
    const connection = createScrapeEventSource();
    source = connection;
    connection.onopen = () => {
      if (attempt === generation) state.value = 'open';
    };
    connection.onmessage = (event) => {
      if (attempt !== generation) return;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (typeof data.type === 'string') handlers[data.type]?.(data);
    };
    connection.onerror = () => {
      if (attempt !== generation) return;
      connection.close();
      source = null;
      state.value = 'reconnect-wait';
      timer = setTimeout(() => {
        timer = null;
        if (attempt === generation) connect();
      }, 3000);
    };
  }
  onUnmounted(() => {
    disconnect();
    state.value = 'disposed';
  });
  return { connect, disconnect, state, isConnected: computed(() => state.value === 'open') };
}
