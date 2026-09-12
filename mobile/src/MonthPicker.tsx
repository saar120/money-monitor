import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { useMemo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppColors } from './theme';

export function formatMonthLabel(month: string, short = false) {
  return new Intl.DateTimeFormat('en', {
    month: short ? 'short' : 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T12:00:00Z`));
}

export function MonthPicker({
  month,
  months,
  onSelect,
  testID,
}: {
  month: string;
  months: string[];
  onSelect: (month: string) => void;
  testID?: string;
}) {
  const colors = useAppColors();
  const supportsGlass = Platform.OS === 'ios' && isGlassEffectAPIAvailable();
  const options = useMemo(
    () => [...new Set([month, ...months].filter(Boolean))].sort().reverse(),
    [month, months],
  );
  const index = options.indexOf(month);
  const older = options[index + 1];
  const newer = index > 0 ? options[index - 1] : undefined;
  const content = (
    <>
      <MonthButton
        direction="left"
        month={older}
        onPress={onSelect}
        testID={testID ? `${testID}-previous` : undefined}
      />
      <View style={[styles.divider, { backgroundColor: colors.glassBorder }]} />
      <Text
        adjustsFontSizeToFit
        allowFontScaling={false}
        minimumFontScale={0.85}
        numberOfLines={1}
        style={[styles.label, { color: colors.text }]}
      >
        {formatMonthLabel(month)}
      </Text>
      <View style={[styles.divider, { backgroundColor: colors.glassBorder }]} />
      <MonthButton
        direction="right"
        month={newer}
        onPress={onSelect}
        testID={testID ? `${testID}-next` : undefined}
      />
    </>
  );

  return supportsGlass ? (
    <GlassView
      glassEffectStyle="regular"
      style={styles.switcher}
      testID={testID}
      tintColor={colors.glass}
    >
      {content}
    </GlassView>
  ) : (
    <View
      style={[
        styles.switcher,
        styles.fallback,
        {
          backgroundColor: colors.glass,
          borderColor: colors.glassBorder,
          shadowColor: colors.glassShadow,
        },
      ]}
      testID={testID}
    >
      {content}
    </View>
  );
}

function MonthButton({
  direction,
  month,
  onPress,
  testID,
}: {
  direction: 'left' | 'right';
  month?: string;
  onPress: (month: string) => void;
  testID?: string;
}) {
  const colors = useAppColors();
  const label = direction === 'left' ? 'Previous' : 'Next';
  return (
    <Pressable
      accessibilityLabel={
        month ? `${label} month, ${formatMonthLabel(month)}` : `${label} month unavailable`
      }
      accessibilityRole="button"
      accessibilityState={{ disabled: !month }}
      disabled={!month}
      hitSlop={4}
      onPress={() => {
        if (month) onPress(month);
      }}
      style={({ pressed }) => [styles.button, { opacity: !month ? 0.24 : pressed ? 0.5 : 1 }]}
      testID={testID}
    >
      <SymbolView
        name={direction === 'left' ? 'chevron.left' : 'chevron.right'}
        size={13}
        tintColor={colors.text}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  switcher: {
    minWidth: 218,
    height: 42,
    borderRadius: 21,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  fallback: {
    borderWidth: StyleSheet.hairlineWidth,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
  },
  button: { width: 44, height: 42, alignItems: 'center', justifyContent: 'center' },
  divider: { width: StyleSheet.hairlineWidth, height: 18 },
  label: {
    flex: 1,
    paddingHorizontal: 8,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '600',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
});
