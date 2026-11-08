export type SseFrame = { event: string; data: string };
export function createSseParser(emit: (frame: SseFrame) => void, limit = 1_048_576) {
  let buffer = '';
  let event = '';
  let data: string[] = [];
  let size = 0;
  function line(value: string) {
    if (!value) {
      if (data.length) emit({ event: event || 'message', data: data.join('\n') });
      event = '';
      data = [];
      size = 0;
      return;
    }
    size += value.length;
    if (size > limit) throw new Error('Stream frame too large');
    if (value.startsWith(':')) return;
    const colon = value.indexOf(':');
    const field = colon === -1 ? value : value.slice(0, colon);
    const content = colon === -1 ? '' : value.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = content;
    if (field === 'data') data.push(content);
  }
  function consume(eof: boolean) {
    while (true) {
      const boundary = buffer.search(/[\r\n]/);
      if (boundary === -1 || (!eof && buffer[boundary] === '\r' && boundary === buffer.length - 1))
        break;
      const length = buffer[boundary] === '\r' && buffer[boundary + 1] === '\n' ? 2 : 1;
      const value = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + length);
      line(value);
    }
    if (buffer.length + size > limit) throw new Error('Stream frame too large');
  }
  return {
    push(chunk: string) {
      buffer += chunk;
      consume(false);
    },
    // SSE only dispatches delimited events; EOF must not invent an accepted outcome.
    finish() {
      consume(true);
      buffer = '';
      data = [];
      event = '';
      size = 0;
    },
  };
}
