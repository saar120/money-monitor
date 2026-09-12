export type CategoryArc<T> = T & {
  endAngle: number;
  share: number;
  startAngle: number;
  sweepAngle: number;
};

export function categoryArcs<T extends { spent: number }>(categories: T[]): CategoryArc<T>[] {
  const visible = categories.filter((category) => category.spent > 0);
  const total = visible.reduce((sum, category) => sum + category.spent, 0);
  let startAngle = 0;

  return visible.map((category) => {
    const share = category.spent / total;
    const sweepAngle = share * 360;
    const arc = {
      ...category,
      startAngle,
      endAngle: startAngle + sweepAngle,
      share,
      sweepAngle,
    };
    startAngle = arc.endAngle;
    return arc;
  });
}

export function categoryAtAngle<T>(arcs: CategoryArc<T>[], angle: number) {
  const normalized = ((angle % 360) + 360) % 360;
  return arcs.find((arc) => normalized >= arc.startAngle && normalized < arc.endAngle) ?? null;
}
