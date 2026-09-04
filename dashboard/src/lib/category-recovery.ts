export function intendedNullableColor(
  original: string | null,
  draft: string,
  fallback: string,
): string | null {
  return original === null && draft === fallback ? null : draft;
}

export function toggleWasAccepted(
  categories: ReadonlyArray<{ id: number; ignoredFromStats: boolean }>,
  id: number,
  intended: boolean,
): boolean {
  return categories.find((category) => category.id === id)?.ignoredFromStats === intended;
}

export function toggleRecoveryDecision(
  categories: ReadonlyArray<{ id: number; ignoredFromStats: boolean }>,
  id: number,
  intended: boolean,
): 'accepted' | 'reapply' {
  return toggleWasAccepted(categories, id, intended) ? 'accepted' : 'reapply';
}

export function emptyCategoryCreateDraft(idempotencyKey: string, defaultColor: string) {
  return {
    name: '',
    label: '',
    color: defaultColor,
    rules: '',
    owner: 'unassigned',
    ignored: false,
    idempotencyKey,
    attemptedPayload: '',
  } as const;
}
