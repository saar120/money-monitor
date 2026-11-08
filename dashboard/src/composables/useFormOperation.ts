import { computed, onScopeDispose, shallowRef } from 'vue';

type Operation = { id: number; target: string | number; draft: unknown };
type FormOperation =
  | { phase: 'idle' }
  | ({ operation: Operation } & (
      { phase: 'submitting' | 'accepted' } | { phase: 'failed'; error: unknown }
    ));

/** A form owns its submitted target and draft until the write settles. */
export function useFormOperation() {
  const state = shallowRef<FormOperation>({ phase: 'idle' });
  let sequence = 0;
  let disposed = false;
  onScopeDispose(() => {
    disposed = true;
    sequence++;
  });
  const pending = computed(() => state.value.phase === 'submitting');
  async function run<Draft, Result>(
    target: string | number,
    draft: Draft,
    write: (draft: Draft) => Promise<Result>,
  ): Promise<
    | { status: 'accepted'; result: Result }
    | { status: 'failed'; error: unknown }
    | { status: 'retired' }
  > {
    if (disposed || pending.value) return { status: 'retired' };
    const operation = { id: ++sequence, target, draft };
    state.value = { phase: 'submitting', operation };
    try {
      const result = await write(draft);
      if (disposed || operation.id !== sequence) return { status: 'retired' };
      state.value = { phase: 'accepted', operation };
      return { status: 'accepted', result };
    } catch (error) {
      if (disposed || operation.id !== sequence) return { status: 'retired' };
      state.value = { phase: 'failed', operation, error };
      return { status: 'failed', error };
    }
  }
  return { state, pending, run };
}
