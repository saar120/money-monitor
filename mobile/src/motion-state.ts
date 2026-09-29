export function chartIndexAtPosition(x: number, width: number, count: number): number {
  'worklet';
  if (count <= 0 || width <= 0) return -1;
  return Math.min(count - 1, Math.max(0, Math.floor((x / width) * count)));
}

export function adjacentMonth(month: string, months: string[], translation: number, rtl: boolean) {
  const ordered = [...new Set(months)].sort();
  const index = ordered.indexOf(month);
  if (index < 0 || translation === 0) return undefined;
  // Drag toward the reading direction to bring the previous month into view.
  const step = translation * (rtl ? -1 : 1) > 0 ? -1 : 1;
  return ordered[index + step];
}
