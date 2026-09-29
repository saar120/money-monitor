import { MorphingArea, MorphingLine } from '@/MorphingChart';
import { Circle, Line as SkiaLine, vec } from '@shopify/react-native-skia';
import { runOnJS, useAnimatedReaction, useDerivedValue } from 'react-native-reanimated';
import { RollingAmount } from '@/Motion';
import { t } from '@/localization';
import { currentLocale } from '@/locale-state';
import { Text } from '@/LocalizedText';
import { CartesianChart, useChartPressState } from 'victory-native';
import { useState, useMemo } from 'react';
import { ScrollView, StyleSheet, useColorScheme, View } from 'react-native';
import { ConnectionState } from '@/ConnectionState';
import { GlassSegmentedControl } from '@/GlassSegmentedControl';
import { useMoneyData } from '@/MoneyData';
import { formatMoney, formatUnsignedMoney } from '@/money';
import { chartColors, useAppColors } from '@/theme';

const worthKeys: 'total'[] = ['total'];
const worthPadding = { left: 4, right: 4, top: 10, bottom: 4 };
const worthDomainPadding = { top: 16, bottom: 10 };
const worthPress = { pan: { activateAfterLongPress: 120 } };

export default function NetWorthScreen() {
  const colors = useAppColors();
  const chart = chartColors(useColorScheme() === 'dark');
  const { home, status } = useMoneyData();
  const { state, isActive } = useChartPressState({ x: 0, y: { total: 0 } });
  const [range, setRange] = useState<'3' | '6' | '12'>('12');
  const [selection, setSelection] = useState<{ range: string; index: number } | null>(null);
  const selectedIndex = selection?.range === range ? selection.index : -1;
  const selectIndex = (index: number) => setSelection({ range, index });
  const guideTop = useDerivedValue(() => vec(state.x.position.value, 10));
  const guideBottom = useDerivedValue(() => vec(state.x.position.value, 210));
  useAnimatedReaction(
    () => (state.isActive.value ? state.matchedIndex.value : -1),
    (index, previous) => {
      if (index >= 0 && index !== previous) runOnJS(selectIndex)(index);
    },
  );
  const history = useMemo(
    () =>
      (home?.netWorthHistory ?? []).slice(-Number(range)).map((point, index) => ({
        index,
        total: point.total,
        date: point.date,
      })),
    [home?.netWorthHistory, range],
  );
  if (status !== 'ready' || !home) return <ConnectionState />;
  const inspected = history[selectedIndex];
  const inspectedDate = inspected
    ? new Intl.DateTimeFormat(currentLocale(), { month: 'long', year: 'numeric' }).format(
        new Date(`${inspected.date}T12:00:00Z`),
      )
    : t('now');
  const assets = home.assets ?? home.netWorth;
  const liabilities = home.liabilities ?? 0;
  const compositionTotal = Math.max(assets + liabilities, 1);
  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      testID="net-worth-detail"
    >
      <RollingAmount
        style={[styles.amount, { color: colors.text }]}
        value={formatUnsignedMoney(inspected?.total ?? home.netWorth, home.currencyCode)}
        testID="net-worth-live-amount"
      />
      <Text style={[styles.label, { color: colors.secondary }]} testID="net-worth-live-date">
        {inspectedDate}
      </Text>
      {home.netWorthChange !== null ? (
        <Text
          allowFontScaling={false}
          style={[
            styles.change,
            { color: home.netWorthChange >= 0 ? colors.positive : colors.danger },
          ]}
        >
          {formatMoney(home.netWorthChange, home.currencyCode)} {t('thisMonth')}
        </Text>
      ) : null}
      <View style={styles.rangeSpacing}>
        <GlassSegmentedControl
          compact
          onChange={(next) => {
            state.isActive.value = false;
            setSelection(null);
            setRange(next);
          }}
          options={[
            { label: t('message3M'), value: '3' },
            { label: t('message6M'), value: '6' },
            { label: t('message1Y'), value: '12' },
          ]}
          testID="net-worth-range"
          value={range}
        />
      </View>
      <View
        style={styles.chart}
        accessible
        accessibilityRole="adjustable"
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => {
          const index = selectedIndex < 0 ? history.length - 1 : selectedIndex;
          if (history.length)
            selectIndex(
              Math.max(
                0,
                Math.min(
                  history.length - 1,
                  index + (event.nativeEvent.actionName === 'increment' ? 1 : -1),
                ),
              ),
            );
        }}
        testID="net-worth-scrubber"
        accessibilityLabel={`${inspectedDate}, ${t('netWorthHistoryEnding', {
          amount: formatUnsignedMoney(inspected?.total ?? home.netWorth, home.currencyCode),
        })}`}
      >
        {history.length > 1 ? (
          <CartesianChart
            chartPressState={state}
            chartPressConfig={worthPress}
            data={history}
            xKey="index"
            yKeys={worthKeys}
            domainPadding={worthDomainPadding}
            padding={worthPadding}
          >
            {({ points, chartBounds }) => (
              <>
                <MorphingArea
                  points={points.total}
                  y0={chartBounds.bottom}
                  color={chart.fill}
                  opacity={0.7}
                  curveType="linear"
                />
                <MorphingLine
                  points={points.total}
                  color={chart.primary}
                  strokeWidth={3}
                  curveType="linear"
                />
                {isActive ? (
                  <SkiaLine
                    p1={guideTop}
                    p2={guideBottom}
                    color={colors.tertiary}
                    strokeWidth={1}
                  />
                ) : null}
                {inspected && points.total[selectedIndex] ? (
                  <>
                    <Circle
                      cx={isActive ? state.x.position : points.total[selectedIndex]!.x}
                      cy={isActive ? state.y.total.position : points.total[selectedIndex]!.y!}
                      r={11}
                      color={colors.accentSoft}
                    />
                    <Circle
                      cx={isActive ? state.x.position : points.total[selectedIndex]!.x}
                      cy={isActive ? state.y.total.position : points.total[selectedIndex]!.y!}
                      r={5}
                      color={colors.accent}
                    />
                  </>
                ) : null}
              </>
            )}
          </CartesianChart>
        ) : (
          <View style={styles.noChart}>
            <Text style={[styles.note, { color: colors.secondary }]}>
              {t('noHistoryAvailableYet')}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.historyLabels}>
        {history.length ? (
          <>
            <Text style={[styles.label, { color: colors.secondary }]}>
              {new Intl.DateTimeFormat(currentLocale(), { month: 'short', year: 'numeric' }).format(
                new Date(`${history[0]!.date}T12:00:00Z`),
              )}
            </Text>
            <Text style={[styles.label, { color: colors.secondary }]}>{t('now')}</Text>
          </>
        ) : null}
      </View>

      <View style={[styles.rule, { backgroundColor: colors.separator }]} />
      <Text style={[styles.title, { color: colors.text }]}>{t('composition')}</Text>
      <View style={[styles.composition, { backgroundColor: colors.dangerSoft }]}>
        <View
          style={[
            styles.assetsFill,
            {
              width: `${Math.min((assets / compositionTotal) * 100, 100)}%`,
              backgroundColor: colors.positive,
            },
          ]}
        />
      </View>
      <View style={styles.compositionLabels}>
        <View>
          <Text style={[styles.label, { color: colors.secondary }]}>{t('assets')}</Text>
          <Text allowFontScaling={false} style={[styles.value, { color: colors.text }]}>
            {formatUnsignedMoney(assets, home.currencyCode)}
          </Text>
        </View>
        <View style={styles.right}>
          <Text style={[styles.label, { color: colors.secondary }]}>{t('liabilities')}</Text>
          <Text allowFontScaling={false} style={[styles.value, { color: colors.text }]}>
            {formatUnsignedMoney(liabilities, home.currencyCode)}
          </Text>
        </View>
      </View>
      <Text style={[styles.note, { color: colors.secondary }]}>
        {t('calculatedOnYourMacFromConnectedAccountsAssetsAndLiabilities')}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  amount: {
    marginTop: 18,
    fontSize: 42,
    lineHeight: 49,
    fontWeight: '700',
    letterSpacing: -1.4,
    fontVariant: ['tabular-nums'],
  },
  change: { marginTop: 6, fontSize: 15, lineHeight: 21, fontWeight: '600' },
  rangeSpacing: { marginTop: 25 },
  chart: { height: 220, marginTop: 18, direction: 'ltr' },
  noChart: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  historyLabels: {
    direction: 'ltr',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 30 },
  title: { fontSize: 21, lineHeight: 27, fontWeight: '700' },
  composition: { height: 10, borderRadius: 5, overflow: 'hidden', marginTop: 18 },
  assetsFill: { height: '100%', borderRadius: 5 },
  compositionLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  right: { alignItems: 'flex-end' },
  label: { fontSize: 12.5 },
  value: { marginTop: 3, fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
  note: { marginTop: 32, fontSize: 13, lineHeight: 19 },
});
