import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ConnectionState } from '@/ConnectionState';
import { GlassSegmentedControl } from '@/GlassSegmentedControl';
import { useExploreHistory, useMoneyData } from '@/MoneyData';
import { formatUnsignedMoney } from '@/money';
import type { ExploreMonth } from '@/mobile-api';
import { useAppColors } from '@/theme';

type Range = '3' | '6' | '12';

export default function MonthlyComparisonScreen() {
  const colors = useAppColors();
  const { home, status } = useMoneyData();
  const { months, loading } = useExploreHistory();
  if (status !== 'ready' || !home) return <ConnectionState />;
  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      testID="monthly-comparison-screen"
    >
      {months.length ? <MonthlyComparison months={months} /> : <Loading loading={loading} />}
    </ScrollView>
  );
}

function MonthlyComparison({ months }: { months: ExploreMonth[] }) {
  const colors = useAppColors();
  const [range, setRange] = useState<Range>('6');
  const series = months.slice(-Number(range));
  const [selectedMonth, setSelectedMonth] = useState(months.at(-1)!.month);
  const selected = months.find((month) => month.month === selectedMonth) ?? months.at(-1)!;
  const categoryNames = selected.categories.slice(0, 6).map((category) => category.name);
  const max = Math.max(1, ...series.map((month) => month.spending));

  return (
    <>
      <GlassSegmentedControl
        onChange={setRange}
        options={[
          { label: '3M', value: '3' },
          { label: '6M', value: '6' },
          { label: '1Y', value: '12' },
        ]}
        testID="monthly-range"
        value={range}
      />
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
      <View style={styles.chart} accessibilityLabel="Monthly spending mix chart">
        <View style={styles.bars}>
          {series.map((month) => {
            const total = Math.max(1, month.spending);
            return (
              <Pressable
                accessibilityLabel={`${monthTitle(month.month)}, ${formatUnsignedMoney(month.spending, month.currencyCode)}`}
                accessibilityRole="button"
                key={month.month}
                onPress={() => setSelectedMonth(month.month)}
                style={styles.month}
              >
                <View
                  style={[
                    styles.bar,
                    {
                      height: Math.max(8, (month.spending / max) * 176),
                      opacity: selected.month === month.month ? 1 : 0.72,
                    },
                  ]}
                >
                  {categoryNames.map((name) => {
                    const category = month.categories.find((item) => item.name === name);
                    if (!category || category.spent <= 0) return null;
                    return (
                      <View
                        key={name}
                        style={{
                          backgroundColor: category.color,
                          height: `${Math.max(3, (category.spent / total) * 100)}%`,
                        }}
                      />
                    );
                  })}
                </View>
                <Text
                  style={[
                    styles.monthLabel,
                    { color: selected.month === month.month ? colors.text : colors.secondary },
                  ]}
                >
                  {month.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Where it went</Text>
      {selected.categories.slice(0, 8).map((category) => (
        <View key={category.name} style={[styles.row, { borderBottomColor: colors.separator }]}>
          <View style={[styles.dot, { backgroundColor: category.color }]} />
          <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>
            {category.name}
          </Text>
          <Text allowFontScaling={false} style={[styles.amount, { color: colors.text }]}>
            {formatUnsignedMoney(category.spent, selected.currencyCode)}
          </Text>
        </View>
      ))}
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
  summary: {
    marginTop: 28,
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
  chart: { height: 228, marginTop: 22 },
  bars: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  month: { flex: 1, minHeight: 220, alignItems: 'center', justifyContent: 'flex-end' },
  bar: {
    width: '72%',
    maxWidth: 34,
    borderRadius: 7,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  monthLabel: { marginTop: 8, fontSize: 10.5, fontWeight: '600' },
  sectionTitle: {
    marginTop: 34,
    marginBottom: 7,
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '700',
    letterSpacing: -0.35,
  },
  row: {
    minHeight: 54,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dot: { width: 9, height: 9, borderRadius: 5 },
  name: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    marginRight: 12,
    fontSize: 15,
    fontWeight: '600',
  },
  amount: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  loading: { minHeight: 260, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 12, fontSize: 14 },
});
