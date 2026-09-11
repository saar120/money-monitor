import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ConnectionState } from '@/ConnectionState';
import { GlassSegmentedControl } from '@/GlassSegmentedControl';
import { useMoneyData } from '@/MoneyData';
import { formatMoney, formatUnsignedMoney, overviewCashFlow } from '@/money';
import type { CashflowMonth } from '@/mobile-api';
import { useAppColors } from '@/theme';

type Range = '1' | '3' | '6';

export default function ExploreScreen() {
  const colors = useAppColors();
  const money = useMoneyData();
  const { home, status } = money;
  const [range, setRange] = useState<Range>('6');
  const [history, setHistory] = useState<CashflowMonth[]>([]);

  useEffect(() => {
    if (status !== 'ready' || !home) return;
    let current = true;
    void money
      .loadCashflowHistory()
      .then((value) => {
        if (current) setHistory(value);
      })
      .catch(() => {
        if (current) setHistory([]);
      });
    return () => {
      current = false;
    };
  }, [home, money, status]);

  if (status !== 'ready' || !home) return <ConnectionState />;

  const currentPoint: CashflowMonth = {
    month: home.currentDate.slice(0, 7),
    label: home.month.slice(0, 3),
    income: home.income,
    spending: home.spent,
  };
  const series = (history.length ? history : [currentPoint]).slice(-Number(range));
  const previousPoint = history.at(-2);
  const cashFlow = overviewCashFlow(home.income, home.spent);
  const previousCashFlow = previousPoint
    ? overviewCashFlow(previousPoint.income, previousPoint.spending)
    : null;
  const cashFlowDelta = previousCashFlow === null ? null : cashFlow - previousCashFlow;
  const day = Number(home.currentDate.slice(8, 10));
  const maxBar = Math.max(1, ...series.flatMap((point) => [point.income, point.spending]));
  const categoryChanges = [...home.categories]
    .sort((a, b) => Math.abs(b.spent - b.previous) - Math.abs(a.spent - a.previous))
    .slice(0, 5);
  const leading = categoryChanges[0];
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
      <Text style={[styles.subtitle, { color: colors.secondary }]}>
        Every insight opens the transactions behind it
      </Text>

      <View style={styles.rangeSpacing}>
        <GlassSegmentedControl
          onChange={setRange}
          options={[
            { label: '1M', value: '1' },
            { label: '3M', value: '3' },
            { label: '6M', value: '6' },
          ]}
          testID="explore-range"
          value={range}
        />
      </View>

      <View style={[styles.hero, { borderColor: colors.separator }]}>
        <View style={styles.summaryRow}>
          <Text style={[styles.summaryLabel, { color: colors.secondary }]}>
            {home.month} cash flow
          </Text>
          <Text
            allowFontScaling={false}
            style={[styles.cashFlow, { color: cashFlow >= 0 ? colors.positive : colors.danger }]}
            testID="explore-cashflow"
          >
            {formatMoney(cashFlow, home.currencyCode)}
          </Text>
        </View>
        <Text style={[styles.summaryNote, { color: colors.secondary }]}>
          {cashFlowDelta === null
            ? `Posted income minus spending · through day ${day}`
            : `${formatUnsignedMoney(Math.abs(cashFlowDelta), home.currencyCode)} ${cashFlowDelta >= 0 ? 'better' : 'worse'} than ${previousPoint?.label ?? 'last month'} · through day ${day}`}
        </Text>

        <View style={styles.chart} testID="cashflow-chart">
          <View style={styles.grid} pointerEvents="none">
            {[0, 1, 2].map((line) => (
              <View key={line} style={[styles.gridLine, { backgroundColor: colors.separator }]} />
            ))}
          </View>
          <View style={styles.months}>
            {series.map((point) => (
              <View key={point.month} style={styles.monthGroup}>
                <View style={styles.barPair}>
                  <View
                    style={[
                      styles.bar,
                      {
                        height: Math.max(4, (point.income / maxBar) * 142),
                        backgroundColor: colors.accent,
                      },
                    ]}
                  />
                  <View
                    style={[
                      styles.bar,
                      {
                        height: Math.max(4, (point.spending / maxBar) * 142),
                        backgroundColor: colors.blueSoft,
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.monthLabel, { color: colors.secondary }]}>{point.label}</Text>
              </View>
            ))}
          </View>
        </View>
        <View style={styles.legend}>
          <LegendItem color={colors.accent} label="Posted income" />
          <LegendItem color={colors.blueSoft} label="Posted spending" />
        </View>
      </View>

      <View style={styles.sectionTitleRow}>
        <View style={styles.sectionCopy}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>What changed</Text>
          <Text style={[styles.sectionNote, { color: colors.secondary }]}>
            {home.month} vs. last month by category
          </Text>
        </View>
        <View style={[styles.sourceBadge, { backgroundColor: colors.surfaceSoft }]}>
          <SymbolView name="info.circle" size={13} tintColor={colors.secondary} />
          <Text style={[styles.sourceText, { color: colors.secondary }]}>Calculated</Text>
        </View>
      </View>

      <View style={styles.drivers}>
        {categoryChanges.length ? (
          categoryChanges.map((category) => {
            const delta = category.spent - category.previous;
            return (
              <Pressable
                key={category.name}
                onPress={() =>
                  router.push({ pathname: '/category/[name]', params: { name: category.name } })
                }
                style={({ pressed }) => [
                  styles.driverRow,
                  { borderBottomColor: colors.separator, opacity: pressed ? 0.7 : 1 },
                ]}
                testID={`explore-category-${category.name}`}
              >
                <View
                  style={[
                    styles.driverMark,
                    { backgroundColor: delta > 0 ? colors.warning : colors.positive },
                  ]}
                />
                <View style={styles.driverCopy}>
                  <Text numberOfLines={1} style={[styles.driverName, { color: colors.text }]}>
                    {category.name}
                  </Text>
                  <Text style={[styles.driverMeta, { color: colors.secondary }]}>
                    {formatUnsignedMoney(category.spent, home.currencyCode)} now
                  </Text>
                </View>
                <Text
                  allowFontScaling={false}
                  style={[
                    styles.driverDelta,
                    { color: delta > 0 ? colors.warning : colors.positive },
                  ]}
                >
                  {formatMoney(delta, home.currencyCode)}
                </Text>
                <SymbolView name="chevron.right" size={12} tintColor={colors.tertiary} />
              </Pressable>
            );
          })
        ) : (
          <Text style={[styles.empty, { color: colors.secondary }]}>No category changes yet.</Text>
        )}
      </View>

      {leading ? (
        <Pressable
          onPress={() =>
            router.push({ pathname: '/category/[name]', params: { name: leading.name } })
          }
          style={({ pressed }) => [
            styles.insight,
            { backgroundColor: colors.chart, opacity: pressed ? 0.82 : 1 },
          ]}
        >
          <View style={styles.insightIcon}>
            <SymbolView name="magnifyingglass" size={17} tintColor="#FFFFFF" />
          </View>
          <View style={styles.insightCopy}>
            <Text style={styles.insightTitle}>{leading.name} moved most</Text>
            <Text style={styles.insightText}>
              {formatUnsignedMoney(Math.abs(leading.spent - leading.previous), home.currencyCode)}{' '}
              {leading.spent >= leading.previous ? 'more' : 'less'} than last month.
            </Text>
          </View>
          <SymbolView name="chevron.right" size={13} tintColor="#FFFFFF" />
        </Pressable>
      ) : null}

      {merchantChanges.length ? (
        <View style={[styles.secondarySection, { borderTopColor: colors.separator }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Merchant drivers</Text>
          {merchantChanges.map((merchant) => {
            const delta = merchant.current - merchant.previous;
            return (
              <Pressable
                key={`${merchant.category}-${merchant.name}`}
                onPress={() =>
                  router.push({ pathname: '/merchant/[name]', params: { name: merchant.name } })
                }
                style={[styles.merchantRow, { borderBottomColor: colors.separator }]}
              >
                <View style={styles.driverCopy}>
                  <Text numberOfLines={1} style={[styles.driverName, { color: colors.text }]}>
                    {merchant.name}
                  </Text>
                  <Text style={[styles.driverMeta, { color: colors.secondary }]}>
                    {merchant.category} · {merchant.count} transaction
                    {merchant.count === 1 ? '' : 's'}
                  </Text>
                </View>
                <Text
                  allowFontScaling={false}
                  style={[
                    styles.driverDelta,
                    { color: delta > 0 ? colors.warning : colors.positive },
                  ]}
                >
                  {formatMoney(delta, home.currencyCode)}
                </Text>
                <SymbolView name="chevron.right" size={12} tintColor={colors.tertiary} />
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {home.budgets.length ? (
        <View style={[styles.secondarySection, { borderTopColor: colors.separator }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Budgets</Text>
          {home.budgets.map((budget) => (
            <View key={budget.name} style={styles.budgetRow}>
              <View style={styles.budgetHeading}>
                <Text style={[styles.driverName, { color: colors.text }]}>{budget.name}</Text>
                <Text style={[styles.driverMeta, { color: colors.secondary }]}>
                  {formatUnsignedMoney(Math.abs(budget.remaining), home.currencyCode)}{' '}
                  {budget.remaining < 0 ? 'over' : 'remaining'} · {Math.round(budget.usedPercent)}%
                  used
                </Text>
              </View>
              <View style={[styles.budgetTrack, { backgroundColor: colors.separator }]}>
                <View
                  style={[
                    styles.budgetFill,
                    {
                      width: `${Math.min(budget.usedPercent, 100)}%`,
                      backgroundColor:
                        budget.status === 'over_budget' ? colors.danger : colors.positive,
                    },
                  ]}
                />
              </View>
            </View>
          ))}
        </View>
      ) : null}

      <Pressable
        onPress={() => router.push('/net-worth')}
        style={[styles.netWorth, { borderTopColor: colors.separator }]}
      >
        <View>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Net worth</Text>
          <Text allowFontScaling={false} style={[styles.netWorthAmount, { color: colors.text }]}>
            {formatUnsignedMoney(home.netWorth, home.currencyCode)}
          </Text>
        </View>
        <SymbolView name="chevron.right" size={14} tintColor={colors.tertiary} />
      </Pressable>
    </ScrollView>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  const colors = useAppColors();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={[styles.legendText, { color: colors.secondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 36 },
  subtitle: { marginTop: 2, fontSize: 14, lineHeight: 19 },
  rangeSpacing: { marginTop: 22 },
  hero: {
    marginTop: 20,
    paddingVertical: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  summaryLabel: { fontSize: 14, fontWeight: '500' },
  cashFlow: {
    marginLeft: 16,
    fontSize: 30,
    lineHeight: 35,
    fontWeight: '700',
    letterSpacing: -1.25,
    fontVariant: ['tabular-nums'],
  },
  summaryNote: { marginTop: 4, textAlign: 'right', fontSize: 12.5, lineHeight: 17 },
  chart: { height: 184, marginTop: 16, justifyContent: 'flex-end' },
  grid: { ...StyleSheet.absoluteFill, justifyContent: 'space-between', paddingBottom: 22 },
  gridLine: { height: StyleSheet.hairlineWidth },
  months: { height: 174, flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  monthGroup: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'flex-end' },
  barPair: { height: 146, flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  bar: { flex: 1, minWidth: 7, maxWidth: 18, borderRadius: 4 },
  monthLabel: { marginTop: 7, fontSize: 10.5, fontWeight: '500' },
  legend: { marginTop: 10, flexDirection: 'row', gap: 18 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11.5 },
  sectionTitleRow: { marginTop: 30, flexDirection: 'row', alignItems: 'flex-start' },
  sectionCopy: { flex: 1, minWidth: 0 },
  sectionTitle: { fontSize: 21, lineHeight: 27, fontWeight: '700', letterSpacing: -0.35 },
  sectionNote: { marginTop: 3, fontSize: 12.5, lineHeight: 17 },
  sourceBadge: {
    minHeight: 30,
    marginLeft: 12,
    paddingHorizontal: 10,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  sourceText: { fontSize: 11.5, fontWeight: '600' },
  drivers: { marginTop: 10 },
  driverRow: {
    minHeight: 68,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  driverMark: { width: 7, height: 34, borderRadius: 4 },
  driverCopy: { flex: 1, minWidth: 0 },
  driverName: { fontSize: 16, lineHeight: 20, fontWeight: '600', writingDirection: 'ltr' },
  driverMeta: { marginTop: 3, fontSize: 12.5, lineHeight: 17, writingDirection: 'ltr' },
  driverDelta: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  empty: { paddingVertical: 24, fontSize: 14 },
  insight: {
    minHeight: 76,
    marginTop: 24,
    padding: 15,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  insightIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  insightCopy: { flex: 1, minWidth: 0 },
  insightTitle: { color: '#FFFFFF', fontSize: 14, lineHeight: 18, fontWeight: '700' },
  insightText: { marginTop: 3, color: 'rgba(255,255,255,0.74)', fontSize: 11.5, lineHeight: 16 },
  secondarySection: {
    marginTop: 32,
    paddingTop: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  merchantRow: {
    minHeight: 62,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  budgetRow: { marginTop: 18 },
  budgetHeading: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  budgetTrack: { height: 5, marginTop: 9, borderRadius: 3, overflow: 'hidden' },
  budgetFill: { height: '100%', borderRadius: 3 },
  netWorth: {
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
});
