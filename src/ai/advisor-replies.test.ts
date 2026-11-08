import { describe, it, expect } from 'vitest';
import { createAdvisorReplies, type ReplyStore } from './advisor-replies.js';
import type { Session } from './sessions.js';
import type { ChatEvent } from './agent.js';
const ID = '00000000-0000-4000-8000-000000000001';
function setup() {
  let value: Session = {
    meta: { type: 'meta', id: ID, title: 'New chat', createdAt: '', updatedAt: '' },
    messages: [],
  };
  const store: ReplyStore = {
    get: () => structuredClone(value),
    list: () => [{ id: ID }],
    update: (_, change) => {
      value = change(structuredClone(value));
      return value;
    },
  };
  return { store, read: () => value, replies: createAdvisorReplies(store) };
}
describe('durable Advisor replies', () => {
  it('keeps generation alive after observers detach and replays one outcome across clients', async () => {
    const { replies, read } = setup();
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const generate = async function* (): AsyncGenerator<ChatEvent> {
      calls++;
      await wait;
      yield { type: 'result', text: 'Accepted answer' };
    };
    const input = { id: ID, clientId: 'desktop', message: 'Synthetic question' };
    const first = replies.start(ID, input, generate);
    const detach = first.subscribe(() => {});
    detach();
    expect(replies.start(ID, input, generate).completion).toBe(first.completion);
    expect(() =>
      replies.start(
        ID,
        { ...input, id: '00000000-0000-4000-8000-000000000002', clientId: 'phone' },
        generate,
      ),
    ).toThrow('reply_in_progress');
    expect(() => replies.start(ID, { ...input, message: 'Different question' }, generate)).toThrow(
      'submission_id_reused',
    );
    release();
    expect((await first.completion).state).toBe('completed');
    expect((await replies.start(ID, input, generate).completion).text).toBe('Accepted answer');
    expect(calls).toBe(1);
    expect(read().messages).toHaveLength(2);
    expect(replies.busy(ID)).toBe(false);
  });
  it('detects interrupted accepted work after restart without inventing an answer', async () => {
    const { store } = setup();
    store.update(ID, (session) => ({
      ...session,
      replies: [
        {
          type: 'reply',
          id: ID,
          sessionId: ID,
          clientId: 'phone',
          questionDigest: 'synthetic',
          state: 'generating',
          acceptedAt: '',
        },
      ],
    }));
    const recovered = createAdvisorReplies(store);
    recovered.recover();
    expect(recovered.read(ID, ID)?.state).toBe('interrupted');
    expect(store.get(ID)?.messages).toEqual([]);
  });
  it('does not claim completion if the atomic final exchange cannot be saved', async () => {
    const { store, read } = setup();
    const update = store.update;
    let writes = 0;
    store.update = (id, change) => {
      if (++writes === 2) throw new Error('Synthetic storage failure');
      return update(id, change);
    };
    const replies = createAdvisorReplies(store);
    const handle = replies.start(
      ID,
      { id: ID, clientId: 'desktop', message: 'Synthetic question' },
      async function* () {
        yield { type: 'result', text: 'Unsaved answer' };
      },
    );
    await expect(handle.completion).rejects.toThrow('storage failure');
    expect(replies.busy(ID)).toBe(false);
    expect(read().messages.map((message) => message.role)).toEqual(['user']);
    expect(replies.read(ID, ID)?.state).toBe('interrupted');
  });
});
