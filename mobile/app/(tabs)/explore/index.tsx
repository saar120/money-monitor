import { Area, CartesianChart, Line, useChartPressState } from 'victory-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { runOnJS, useAnimatedReaction } from 'react-native-reanimated';
import { ConnectionState } from '@/ConnectionState';
import { useMoneyData } from '@/MoneyData';
import { formatMoney, formatUnsignedMoney } from '@/money';
import { chartColors, useAppColors } from '@/theme';

export default function ExploreScreen() {
  const colors = useAppColors();
  const chart = chartColors(useColorScheme() === 'dark');
  const { home, status } = useMoneyData();
  const initial = home?.trend.at(-1) ?? { day: 1, current: 0, previous: 0 };
  const { state: pressState, isActive } = useChartPressState({
    x: initial.day,
    y: { current: initial.current, previous: initial.previous },
  });
  const [selected, setSelected] = useState(initial);

  useAnimatedReaction(
    () => ({
      day: Math.round(Number(pressState.x.value.value)),
      current: pressState.y.current.value.value,
      previous: pressState.y.previous.value.value,
    }),
    (value) => runOnJS(setSelected)(value),
  );
  useEffect(() => {
    if (isActive) void Haptics.selectionAsync();
  }, [isActive, selected.day]);
  useEffect(() => {
    const latest = home?.trend.at(-1);
    if (!isActive && latest) setSelected(latest);
  }, [home?.trend, isActive]);

  if (status !== 'ready' || !home) return <ConnectionState />;
  const categoryChanges = [...home.categories].sort(
    (a, b) => Math.abs(b.spent - b.previous) - Math.abs(a.spent - a.previous),
  );
  const maxCategory = Math.max(
    1,
    ...home.categories.flatMap((item) => [item.spent, item.previous]),
  );
  const merchantChanges = [...home.merchants]
    .sort((a, b) => Math.abs(b.current - b.previous) - Math.abs(a.current - a.previous))
    .slice(0, 5);

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
      testID="explore-screen"
    >
      <Text style={[styles.period, { color: colors.secondary }]}>
        {home.month} compared with last month
      </Text>

      <View style={styles.paceHeader}>
        <View style={styles.paceCopy}>
          <Text
            maxFontSizeMultiplier={1.6}
            style={[styles.sectionTitle, { color: colors.text }]}
          >
            Spending pace
          </Text>
          <Text
            maxFontSizeMultiplier={1.6}
            style={[styles.scrubHint, { color: colors.secondary }]}
          >
            Touch and drag to compare any day
          </Text>
        </View>
        <View
          style={[
            styles.paceBadge,
            {
              backgroundColor:
                home.spent <= home.previousSpent ? colors.accentSoft : colors.warningSoft,
            },
          ]}
          testID="pace-delta-badge"
        >
          <Text
            allowFontScaling={false}
            style={[
              styles.paceBadgeText,
              { color: home.spent <= home.previousSpent ? colors.accent : colors.warning },
            ]}
          >
            {formatMoney(home.spent - home.previousSpent, home.currencyCode)}
          </Text>
        </View>
      </View>
      <View style={styles.scrubValues} testID="pace-scrub-value">
        <Text style={[styles.scrubDay, { color: colors.text }]}>
          {home.month.slice(0, 3)} {selected.day}
        </Text>
        <Text allowFontScaling={false} style={[styles.scrubCurrent, { color: colors.text }]}>
          Current {formatUnsignedMoney(selected.current, home.currencyCode)}
        </Text>
        <Text allowFontScaling={false} style={[styles.scrubPrevious, { color: colors.secondary }]}>
          Last month {formatUnsignedMoney(selected.previous, home.currencyCode)}
        </Text>
      </View>
      <View
        style={styles.chart}
        accessible
        testID="spending-chart"
        accessibilityLabel={`Spending pace. Current ${formatUnsignedMoney(selected.current, home.currencyCode)}, previous month ${formatUnsignedMoney(selected.previous, home.currencyCode)} on day ${selected.day}.`}
      >
        {home.trend.length ? (
          <CartesianChart
            data={home.trend}
            xKey="day"
            yKeys={['current', 'previous']}
            chartPressState={pressState}
            domain={{
              y: [
                0,
                Math.max(...home.trend.flatMap((point) => [point.current, point.previous]), 1) *
                  1.08,
              ],
            }}
            padding={{ top: 8, bottom: 4, left: 3, right: 3 }}
          >
            {({ points, chartBounds }) => (
              <>
                <Area
                  points={points.current}
                  y0={chartBounds.bottom}
                  color={chart.fill}
                  opacity={0.65}
                  curveType="natural"
                />
                <Line
                  points={points.previous}
                  color={chart.previous}
                  strokeWidth={2}
                  curveType="natural"
                />
                <Line
                  points={points.current}
                  color={chart.primary}
                  strokeWidth={3}
                  curveType="natural"
                />
              </>
            )}
          </CartesianChart>
        ) : (
          <View style={styles.noChart}>
            <Text style={{ color: colors.secondary }}>No spending yet</Text>
          </View>
        )}
      </View>

      <View style={[styles.rule, { backgroundColor: colors.separator }]} />
      <Text style={[styles.sectionTitle, { color: colors.text }]}>What changed?</Text>
      <Text style={[styles.sectionIntro, { color: colors.secondary }]}>
        Categories ranked by how much they moved.
      </Text>
      {categoryChanges.length ? (
        <View style={styles.comparisonList}>
          {categoryChanges.map((category) => {
            const delta = category.spent - category.previous;
            return (
              <Pressable
                accessibilityHint={`Opens ${category.name} spending details`}
                accessibilityRole="button"
                key={category.name}
                testID={`explore-category-${category.name}`}
                onPress={() =>
                  router.push({
                    pathname: '/(tabs)/explore/category/[name]',
                    params: { name: category.name },
                  })
                }
                style={styles.comparisonRow}
              >
                <View style={styles.comparisonTop}>
                  <Text
                    maxFontSizeMultiplier={1.5}
                    numberOfLines={1}
                    style={[styles.itemName, { color: colors.text }]}
                  >
                    {category.name}
                  </Text>
                  <Text
                    allowFontScaling={false}
                    style={[
                      styles.itemDelta,
                      { color: delta > 0 ? colors.warning : colors.accent },
                    ]}
                  >
                    {formatMoney(delta, home.currencyCode)}
                  </Text>
                </View>
                <View style={styles.comparisonBars}>
                  <View
                    style={[
                      styles.bar,
                      {
                        width: `${(category.previous / maxCategory) * 100}%`,
                        backgroundColor: colors.separator,
                      },
                    ]}
                  />
                  <View
                    style={[
                      styles.bar,
                      {
                        width: `${(category.spent / maxCategory) * 100}%`,
                        backgroundColor: category.color,
                      },
                    ]}
                  />
                </View>
                <View style={styles.comparisonBottom}>
                  <Text
                    allowFontScaling={false}
                    style={[styles.itemAmount, { color: colors.secondary }]}
                  >
                    {formatUnsignedMoney(category.spent, home.currencyCode)} now
                  </Text>
                  <SymbolView name="chevron.right" size={11} tintColor={colors.tertiary} />
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Text style={[styles.emptyText, { color: colors.secondary }]}>
          There’s no spending to compare yet.
        </Text>
      )}

      {merchantChanges.length ? (
        <>
          <View style={[styles.rule, { backgroundColor: colors.separator }]} />
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Merchants moving the most
          </Text>
          <View style={styles.merchantList}>
            {merchantChanges.map((merchant) => {
              const delta = merchant.current - merchant.previous;
              return (
                <Pressable
                  accessibilityHint={`Opens ${merchant.name} merchant details`}
                  accessibilityRole="button"
                  key={`${merchant.category}-${merchant.name}`}
                  testID={`explore-merchant-${merchant.name}`}
                  onPress={() =>
                    router.push({
                      pathname: '/(tabs)/explore/merchant/[name]',
                      params: { name: merchant.name },
                    })
                  }
                  style={styles.merchantRow}
                >
                  <View style={styles.merchantText}>
                    <Text
                      maxFontSizeMultiplier={1.5}
                      numberOfLines={1}
                      style={[styles.itemName, { color: colors.text }]}
                    >
                      {merchant.name}
                    </Text>
                    <Text
                      maxFontSizeMultiplier={1.4}
                      numberOfLines={1}
                      style={[styles.merchantMeta, { color: colors.secondary }]}
                    >
                      {merchant.category} · {merchant.count} transaction
                      {merchant.count === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <Text
                    allowFontScaling={false}
                    style={[
                      styles.itemDelta,
                      { color: delta > 0 ? colors.warning : colors.accent },
                    ]}
                  >
                    {formatMoney(delta, home.currencyCode)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      {home.budgets.length ? (
        <>
          <View style={[styles.rule, { backgroundColor: colors.separator }]} />
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Budgets</Text>
          <View style={styles.budgetList}>
            {home.budgets.map((budget) => (
              <View key={budget.name} style={styles.exploreBudget}>
                <View style={styles.comparisonTop}>
                  <Text
                    maxFontSizeMultiplier={1.5}
                    numberOfLines={1}
                    style={[styles.itemName, { color: colors.text }]}
                  >
                    {budget.name}
                  </Text>
                  <Text
                    allowFontScaling={false}
                    style={[
                      styles.itemAmount,
                      { color: budget.status === 'over_budget' ? colors.danger : colors.secondary },
                    ]}
                  >
                    {Math.round(budget.usedPercent)}% used
                  </Text>
                </View>
                <View style={[styles.budgetTrack, { backgroundColor: colors.separator }]}>
                  <View
                    style={[
                      styles.budgetFill,
                      {
                        width: `${Math.min(budget.usedPercent, 100)}%`,
                        backgroundColor:
                          budget.status === 'over_budget' ? colors.danger : colors.accent,
                      },
                    ]}
                  />
                </View>
                <Text
                  maxFontSizeMultiplier={1.4}
                  style={[styles.merchantMeta, { color: colors.secondary }]}
                >
                  {Math.round(budget.elapsedPercent)}% of the month passed ·{' '}
                  {formatUnsignedMoney(Math.abs(budget.remaining), home.currencyCode)}{' '}
                  {budget.remaining < 0 ? 'over' : 'remaining'}
                </Text>
              </View>
            ))}
          </View>
        </>
      ) : null}

      <Pressable
        accessibilityHint="Opens net worth details"
        accessibilityRole="button"
        onPress={() => router.push('/(tabs)/explore/net-worth')}
        style={[styles.netWorthLink, { borderTopColor: colors.separator }]}
      >
        <View style={styles.netWorthCopy}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Net worth</Text>
          <Text
            adjustsFontSizeToFit
            allowFontScaling={false}
            minimumFontScale={0.8}
            numberOfLines={1}
            style={[styles.netWorthAmount, { color: colors.text }]}
          >
            {formatUnsignedMoney(home.netWorth, home.currencyCode)}
          </Text>
        </View>
        <SymbolView name="chevron.right" size={14} tintColor={colors.tertiary} />
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 50 },
  period: { marginTop: 8, fontSize: 14, fontWeight: '500' },
  paceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginTop: 28,
  },
  paceCopy: { flex: 1, minWidth: 0, marginRight: 12 },
  sectionTitle: { fontSize: 21, lineHeight: 27, fontWeight: '700', letterSpacing: -0.35 },
  scrubHint: { marginTop: 3, fontSize: 12.5 },
  paceBadge: { minHeight: 32, borderRadius: 16, paddingHorizontal: 10, justifyContent: 'center' },
  paceBadgeText: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  scrubValues: { marginTop: 22 },
  scrubDay: { fontSize: 13, fontWeight: '600' },
  scrubCurrent: {
    marginTop: 4,
    fontSize: 25,
    lineHeight: 31,
    fontWeight: '700',
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  scrubPrevious: { marginTop: 2, fontSize: 14, fontVariant: ['tabular-nums'] },
  chart: { height: 185, marginTop: 12 },
  noChart: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 30 },
  sectionIntro: { marginTop: 4, marginBottom: 10, fontSize: 13 },
  comparisonList: { gap: 21, marginTop: 12 },
  emptyText: { marginTop: 16, fontSize: 14, lineHeight: 20 },
  comparisonRow: { minHeight: 72 },
  comparisonTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  itemName: {
    flex: 1,
    minWidth: 0,
    marginRight: 12,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '600',
  },
  itemDelta: { fontSize: 14, lineHeight: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  comparisonBars: { gap: 4, marginTop: 8 },
  bar: { height: 4, borderRadius: 2 },
  comparisonBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 5,
  },
  itemAmount: { fontSize: 12.5, fontVariant: ['tabular-nums'] },
  merchantList: { marginTop: 10 },
  merchantRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  merchantText: { flex: 1, minWidth: 0 },
  merchantMeta: { marginTop: 3, fontSize: 12.5, writingDirection: 'ltr' },
  budgetList: { marginTop: 14, gap: 22 },
  exploreBudget: { minHeight: 64 },
  budgetTrack: { height: 5, borderRadius: 3, overflow: 'hidden', marginTop: 9 },
  budgetFill: { height: '100%', borderRadius: 3 },
  netWorthLink: {
    minHeight: 108,
    marginTop: 34,
    paddingTop: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  netWorthAmount: {
    marginTop: 8,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: -0.8,
    fontVariant: ['tabular-nums'],
  },
  netWorthCopy: { flex: 1, minWidth: 0, marginRight: 12 },
});
