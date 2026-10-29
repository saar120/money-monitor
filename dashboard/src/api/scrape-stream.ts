/** Header-authenticated SSE. Reconnection is owned by useSseConnection. */
export function openScrapeStream(url: string, token: string) {
  const controller = new AbortController();
  const stream = {
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
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      try {
        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) throw new Error('Stream closed');
          buffer += value;
          if (buffer.length > 1_048_576) throw new Error('Stream frame too large');
          let boundary: number;
          while ((boundary = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = frame
              .split('\n')
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).replace(/^ /, ''))
              .join('\n');
            if (data) stream.onmessage?.(new MessageEvent('message', { data }));
          }
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
