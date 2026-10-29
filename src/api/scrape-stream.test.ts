import { expect, it, vi } from 'vitest';
import { openScrapeStream } from '../../dashboard/src/api/scrape-stream.js';

it('streams fragmented events using a header token and cancels cleanly', async () => {
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream({
    start(controller) {
      source = controller;
      controller.enqueue(new TextEncoder().encode('data: {"type":"con'));
      controller.enqueue(new TextEncoder().encode('nected"}\n\n:\n\n'));
    },
  });
  const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  try {
    const stream = openScrapeStream('/api/scrape/events', 'synthetic-token');
    const error = vi.fn();
    stream.onerror = error;
    const event = await new Promise<MessageEvent<string>>((resolve) => {
      stream.onmessage = resolve;
    });
    expect(JSON.parse(event.data)).toEqual({ type: 'connected' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/scrape/events',
      expect.objectContaining({
        headers: { Accept: 'text/event-stream', Authorization: 'Bearer synthetic-token' },
        redirect: 'error',
        cache: 'no-store',
      }),
    );
    stream.close();
    // A real fetch aborts its response body; terminate the synthetic body too.
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(error).not.toHaveBeenCalled();
    source.close();
  } finally {
    vi.unstubAllGlobals();
  }
});
