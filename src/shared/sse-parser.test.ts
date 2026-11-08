import { describe, expect, it } from 'vitest';
import { createSseParser } from './sse-parser.js';
describe('SSE framing', () => {
  it('handles split CRLF, multiline data, trailing CR and incomplete EOF', () => {
    const frames: unknown[] = [];
    const parser = createSseParser((frame) => frames.push(frame));
    parser.push('event: result\r');
    parser.push('\ndata: one\r\ndata: two\r\n\r');
    parser.finish();
    expect(frames).toEqual([{ event: 'result', data: 'one\ntwo' }]);
    parser.push('data: incomplete');
    parser.finish();
    expect(frames).toHaveLength(1);
  });
  it('bounds delimited lines and event metadata as well as data', () => {
    const parser = createSseParser(() => {}, 20);
    expect(() => parser.push('event: ' + 'a'.repeat(30) + '\n')).toThrow('too large');
  });
});
