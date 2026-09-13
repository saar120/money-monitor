import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ExploreMonth } from './mobile-api';
import { useAppColors } from './theme';

export function MonthNavigator({
  months,
  onChange,
  value,
}: {
  months: ExploreMonth[];
  onChange: (month: string) => void;
  value: string;
}) {
  const colors = useAppColors();
  const index = Math.max(
    0,
    months.findIndex((month) => month.month === value),
  );
  const selected = months[index];
  const move = (offset: number) => {
    const next = months[index + offset];
    if (next) onChange(next.month);
  };
  const label = selected
    ? new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
        new Date(`${selected.month}-01T12:00:00Z`),
      )
    : 'Current month';

  return (
    <View
      accessibilityLabel={`Showing ${label}`}
      style={[styles.container, { backgroundColor: colors.surfaceSoft }]}
      testID="month-navigator"
    >
      <MonthButton
        disabled={index === 0}
        label="Previous month"
        onPress={() => move(-1)}
        symbol="chevron.left"
      />
      <Text
        adjustsFontSizeToFit
        maxFontSizeMultiplier={1.35}
        minimumFontScale={0.78}
        numberOfLines={1}
        style={[styles.label, { color: colors.text }]}
      >
        {label}
      </Text>
      <MonthButton
        disabled={index >= months.length - 1}
        label="Next month"
        onPress={() => move(1)}
        symbol="chevron.right"
      />
    </View>
  );
}

function MonthButton({
  disabled,
  label,
  onPress,
  symbol,
}: {
  disabled: boolean;
  label: string;
  onPress: () => void;
  symbol: 'chevron.left' | 'chevron.right';
}) {
  const colors = useAppColors();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { opacity: disabled ? 0.25 : pressed ? 0.55 : 1 }]}
    >
      <SymbolView name={symbol} size={15} tintColor={colors.accent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 46,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  button: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, textAlign: 'center', fontSize: 14, fontWeight: '700' },
});
