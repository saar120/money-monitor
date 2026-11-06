import { StyleSheet, View } from 'react-native';
import { useAppColors } from './theme';

export function budgetStatusColor(
  status: string,
  colors: ReturnType<typeof useAppColors>,
): string {
  if (status === 'over_budget') return colors.danger;
  return status === 'watch' ? colors.warning : colors.positive;
}

// One track for both budget views: the fill is money used, the tick is time elapsed.
export function BudgetBar({
  color,
  elapsedPercent,
  usedPercent,
}: {
  color: string;
  elapsedPercent: number;
  usedPercent: number;
}) {
  const colors = useAppColors();
  return (
    <View style={[styles.track, { backgroundColor: colors.separator }]}>
      <View
        style={[
          styles.fill,
          { backgroundColor: color, width: `${Math.max(0, Math.min(100, usedPercent))}%` },
        ]}
      />
      <View
        style={[
          styles.elapsed,
          {
            backgroundColor: colors.secondary,
            start: `${Math.max(0, Math.min(100, elapsedPercent))}%`,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 8, borderRadius: 4 },
  fill: { height: '100%', borderRadius: 4 },
  elapsed: { position: 'absolute', top: -2, width: 2, height: 12, borderRadius: 1 },
});
