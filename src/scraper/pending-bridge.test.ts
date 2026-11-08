import { describe, it, expect, vi } from 'vitest';
import { createPendingBridge } from './pending-bridge.js';
describe('bank authentication challenges', () => {
  it('settles only the matching challenge and releases cancellation and timeout ownership', async () => {
    vi.useFakeTimers();
    try {
      const bridge = createPendingBridge<string>(1000, 'OTP');
      const first = bridge.waitFor(1, () => {});
      const old = bridge.challenges()[0]!;
      const replaced = expect(first).rejects.toThrow('cancelled');
      const controller = new AbortController();
      const second = bridge.waitFor(1, () => {}, { sessionId: 2, signal: controller.signal });
      const current = bridge.challenges()[0]!;
      await replaced;
      expect(bridge.confirm(1, 'old', old.challengeId)).toBe(false);
      expect(bridge.confirm(1, 'valid', current.challengeId)).toBe(true);
      expect(bridge.confirm(1, 'repeat', current.challengeId)).toBe(false);
      expect(await second).toBe('valid');
      controller.abort();
      const timeout = bridge.waitFor(1, () => {});
      const timed = expect(timeout).rejects.toThrow('timeout');
      await vi.advanceTimersByTimeAsync(1000);
      await timed;
      const abort = new AbortController();
      const pending = bridge.waitFor(1, () => {}, { signal: abort.signal });
      const cancelled = expect(pending).rejects.toThrow('cancelled');
      abort.abort();
      await cancelled;
      expect(bridge.challenges()).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
