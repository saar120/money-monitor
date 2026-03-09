import { ref, onUnmounted } from 'vue';
import { createScrapeEventSource, ensureScrapeEventsAuth } from '../api/client';

export type SseHandlers = Record<string, (data: Record<string, unknown>) => void>;

export function useSseConnection(handlers: SseHandlers) {
  const isConnected = ref(false);

  let eventSource: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  async function connect() {
    disconnect();

    try {
      await ensureScrapeEventsAuth();
      eventSource = createScrapeEventSource();
      isConnected.value = true;
    } catch {
      isConnected.value = false;
      reconnectTimer = setTimeout(() => { void connect(); }, 3000);
      return;
    }

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data) as Record<string, unknown>;
      const type = data.type as string | undefined;
      if (type && handlers[type]) {
        handlers[type](data);
      }
    };

    eventSource.onerror = () => {
      eventSource?.close();
      isConnected.value = false;
      reconnectTimer = setTimeout(() => { void connect(); }, 3000);
    };
  }

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    isConnected.value = false;
  }

  onUnmounted(disconnect);

  return { connect, disconnect, isConnected };
}
