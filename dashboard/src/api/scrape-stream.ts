import { createSseParser } from '../../../src/shared/sse-parser';
/** Header-authenticated SSE. Reconnection is owned by useSseConnection. */
export function openScrapeStream(url: string, token: string) {
  const controller = new AbortController();
  const stream = {
    onopen: null as (() => void) | null,
    onmessage: null as ((event: MessageEvent<string>) => void) | null,
    onerror: null as (() => void) | null,
    close: () => controller.abort(),
  };
  void (async () => {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'text/event-stream',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: controller.signal,
        cache: 'no-store',
        redirect: 'error',
      });
      if (!response.ok || !response.body) throw new Error('Stream unavailable');
      if (controller.signal.aborted) return;
      stream.onopen?.();
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      const parser = createSseParser(({ data }) =>
        stream.onmessage?.(new MessageEvent('message', { data })),
      );
      try {
        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) throw new Error('Stream closed');
          parser.push(value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    } catch {
      if (!controller.signal.aborted) stream.onerror?.();
    }
  })();
  return stream;
}
