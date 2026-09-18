import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ConnectionState } from '@/ConnectionState';
import { GlassSegmentedControl } from '@/GlassSegmentedControl';
import { useExploreHistory, useMoneyData } from '@/MoneyData';
import {
  formatCompactNumber,
  formatMoney,
  formatUnsignedMoney,
  monthlyCategoryNames,
  monthlyCategorySpending,
  niceChartMaximum,
} from '@/money';
import type { ExploreMonth } from '@/mobile-api';
import { useAppColors } from '@/theme';

type Range = '3' | '6' | '12';

export default function MonthlyComparisonScreen() {
  const colors = useAppColors();
  const { month } = useLocalSearchParams<{ month?: string }>();
  const { home, status } = useMoneyData();
  const { months, loading } = useExploreHistory();
  if (status !== 'ready' || !home) return <ConnectionState />;
  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
      testID="monthly-comparison-screen"
    >
      {months.length ? (
        <MonthlyComparison initialMonth={month} months={months} />
      ) : (
        <Loading loading={loading} />
      )}
    </ScrollView>
  );
}

function MonthlyComparison({
  initialMonth,
  months,
}: {
  initialMonth?: string;
  months: ExploreMonth[];
}) {
  const colors = useAppColors();
  const [range, setRange] = useState<Range>('6');
  const series = months.slice(-Number(range));
  const fallback = series.at(-1)!;
  const [selectedMonth, setSelectedMonth] = useState(
    series.some((item) => item.month === initialMonth) ? initialMonth! : fallback.month,
  );
  const selected = series.find((item) => item.month === selectedMonth) ?? fallback;
  const categoryNames = monthlyCategoryNames(series);
  const axisMax = niceChartMaximum(Math.max(...series.map(monthlyCategorySpending)), 5);
  const ticks = Array.from({ length: 6 }, (_, index) => axisMax - (axisMax / 5) * index);
  const visibleCategories = selected.categories.filter((category) => category.spent !== 0);
  const selectedCategorySpending = monthlyCategorySpending(selected);

  return (
    <>
      <View style={styles.pickerRow}>
        <GlassSegmentedControl
          compact
          onChange={(value) => {
            setRange(value);
            setSelectedMonth(months.at(-1)!.month);
          }}
          options={[
            { label: '3M', value: '3' },
            { label: '6M', value: '6' },
            { label: '1Y', value: '12' },
          ]}
          testID="monthly-range"
          value={range}
        />
      </View>

      <View style={styles.summary}>
        <View>
          <Text style={[styles.label, { color: colors.secondary }]}>
            {monthTitle(selected.month)}
          </Text>
          <Text allowFontScaling={false} style={[styles.total, { color: colors.text }]}>
            {formatUnsignedMoney(selected.spending, selected.currencyCode)}
          </Text>
        </View>
        <Text style={[styles.summaryNote, { color: colors.secondary }]}>posted spending</Text>
      </View>

      <View
        style={styles.chart}
        accessibilityLabel="Monthly net category spending chart, net receipts excluded"
      >
        <View style={styles.axis}>
          {ticks.map((tick) => (
            <Text
              key={tick}
              allowFontScaling={false}
              style={[styles.axisLabel, { color: colors.tertiary }]}
            >
              {formatCompactNumber(tick)}
            </Text>
          ))}
        </View>
        <View style={styles.plot}>
          <View pointerEvents="none" style={styles.guides}>
            {ticks.map((tick) => (
              <View key={tick} style={[styles.guide, { backgroundColor: colors.separator }]} />
            ))}
          </View>
          <View style={[styles.bars, range === '12' && { gap: 0 }]}>
            {series.map((item) => {
              const total = monthlyCategorySpending(item);
              const selectedBar = selected.month === item.month;
              return (
                <Pressable
                  accessibilityLabel={`${monthTitle(item.month)}, ${formatUnsignedMoney(total, item.currencyCode)} net category spending`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: selectedBar }}
                  key={item.month}
                  onPress={() => setSelectedMonth(item.month)}
                  style={styles.month}
                  testID={`monthly-bar-${item.month}`}
                >
                  <View
                    style={[
                      styles.bar,
                      {
                        height: (total / axisMax) * 168,
                      },
                    ]}
                  >
                    {categoryNames.map((name) => {
                      const category = item.categories.find((candidate) => candidate.name === name);
                      if (!category || category.spent <= 0) return null;
                      return (
                        <View
                          key={name}
                          style={{
                            backgroundColor: category.color,
                            height: `${(category.spent / total) * 100}%`,
                            flexShrink: 0,
                          }}
                        />
                      );
                    })}
                  </View>
                  <Text
                    allowFontScaling={false}
                    numberOfLines={1}
                    style={[
                      styles.monthLabel,
                      { color: selectedBar ? colors.text : colors.secondary },
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
      <Text style={[styles.chartNote, { color: colors.secondary }]}>
        Net category spending. Net receipts are excluded from the chart and listed below.
      </Text>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Where it went</Text>
      <View style={[styles.categoryList, { backgroundColor: colors.surface }]}>
        {visibleCategories.map((category, index) => {
          const percent =
            selectedCategorySpending > 0
              ? Math.round((category.spent / selectedCategorySpending) * 100)
              : 0;
          return (
            <Pressable
              accessibilityHint={`Opens ${category.name} merchants and transactions`}
              accessibilityRole="button"
              key={category.name}
              onPress={() =>
                router.push({
                  pathname: '/category/[name]',
                  params: { name: category.name, month: selected.month },
                })
              }
              style={({ pressed }) => [
                styles.row,
                {
                  borderBottomColor: colors.separator,
                  borderBottomWidth:
                    index === visibleCategories.length - 1 ? 0 : StyleSheet.hairlineWidth,
                  opacity: pressed ? 0.62 : 1,
                },
              ]}
              testID={`monthly-category-${category.name}`}
            >
              <View style={[styles.dot, { backgroundColor: category.color }]} />
              <View style={styles.categoryName}>
                <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>
                  {category.name}
                </Text>
                {category.spent < 0 ? (
                  <Text style={[styles.creditLabel, { color: colors.secondary }]}>
                    Net received
                  </Text>
                ) : null}
              </View>
              <Text allowFontScaling={false} style={[styles.percent, { color: colors.secondary }]}>
                {category.spent > 0 ? `${percent}%` : '—'}
              </Text>
              <Text allowFontScaling={false} style={[styles.amount, { color: colors.text }]}>
                {category.spent < 0
                  ? formatMoney(category.spent, selected.currencyCode)
                  : formatUnsignedMoney(category.spent, selected.currencyCode)}
              </Text>
              <SymbolView name="chevron.right" size={10} tintColor={colors.tertiary} />
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

function Loading({ loading }: { loading: boolean }) {
  const colors = useAppColors();
  return (
    <View style={styles.loading}>
      {loading ? <ActivityIndicator color={colors.accent} /> : null}
      <Text style={[styles.loadingText, { color: colors.secondary }]}>
        {loading ? 'Loading monthly comparison…' : 'No monthly data available.'}
      </Text>
    </View>
  );
}

function monthTitle(month: string) {
  return new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${month}-01T12:00:00Z`),
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  pickerRow: { alignItems: 'center' },
  summary: {
    marginTop: 24,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  label: { fontSize: 13, fontWeight: '600' },
  total: {
    marginTop: 4,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '700',
    letterSpacing: -1.1,
    fontVariant: ['tabular-nums'],
  },
  summaryNote: { paddingBottom: 5, fontSize: 12.5 },
  chart: { height: 214, marginTop: 22, flexDirection: 'row', gap: 9 },
  axis: { width: 28, height: 168, justifyContent: 'space-between', alignItems: 'flex-end' },
  axisLabel: { fontSize: 9.5, lineHeight: 11, fontVariant: ['tabular-nums'] },
  plot: { flex: 1, height: 202 },
  guides: {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,
    height: 168,
    justifyContent: 'space-between',
  },
  guide: { width: '100%', height: StyleSheet.hairlineWidth },
  bars: {
    position: 'absolute',
    top: 0,
    right: 0,
    height: 168,
    left: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 9,
  },
  month: { flex: 1, height: 168, alignItems: 'center', justifyContent: 'flex-end' },
  bar: {
    width: '54%',
    maxWidth: 24,
    minWidth: 9,
    borderRadius: 5,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  monthLabel: {
    position: 'absolute',
    top: 168,
    marginTop: 8,
    width: 30,
    textAlign: 'center',
    fontSize: 10.5,
    lineHeight: 13,
    fontWeight: '600',
  },
  chartNote: { fontSize: 12, lineHeight: 17 },
  sectionTitle: {
    marginTop: 30,
    marginBottom: 10,
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '700',
    letterSpacing: -0.35,
  },
  categoryList: { borderRadius: 16, paddingHorizontal: 14, overflow: 'hidden' },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 9 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  categoryName: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '600' },
  creditLabel: { marginTop: 2, fontSize: 11, lineHeight: 15 },
  percent: { width: 35, textAlign: 'right', fontSize: 12.5, fontVariant: ['tabular-nums'] },
  amount: {
    minWidth: 72,
    textAlign: 'right',
    fontSize: 13.5,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  loading: { minHeight: 260, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 12, fontSize: 14 },
});
