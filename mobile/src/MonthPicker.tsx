import { currentLocale } from './locale-state';
import { t, useLanguage } from './localization';
import { Text } from './LocalizedText';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { useMemo } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useAppColors } from './theme';

export function formatMonthLabel(month: string, short = false) {
  return new Intl.DateTimeFormat(currentLocale(), {
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
        {formatMonthLabel(month, true)}
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
  const { language } = useLanguage();
  return (
    <Pressable
      accessibilityLabel={
        month
          ? t(direction === 'left' ? 'previousMonthLabel' : 'nextMonthLabel', {
              month: formatMonthLabel(month),
            })
          : t(direction === 'left' ? 'previousMonthUnavailable' : 'nextMonthUnavailable')
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
        name={
          direction === 'left'
            ? language === 'he'
              ? 'chevron.right'
              : 'chevron.left'
            : language === 'he'
              ? 'chevron.left'
              : 'chevron.right'
        }
        size={13}
        tintColor={colors.text}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  switcher: {
    minWidth: 176,
    height: 40,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  fallback: {
    borderWidth: StyleSheet.hairlineWidth,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  button: { width: 44, height: 40, alignItems: 'center', justifyContent: 'center' },
  divider: { width: StyleSheet.hairlineWidth, height: 16 },
  label: {
    flex: 1,
    paddingHorizontal: 6,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
});
