import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ConnectionState } from '@/ConnectionState';
import { GlassSegmentedControl } from '@/GlassSegmentedControl';
import { useExploreHistory, useMoneyData } from '@/MoneyData';
import { formatMoney, formatUnsignedMoney, overviewCashFlow } from '@/money';
import type { ExploreMonth } from '@/mobile-api';
import { useAppColors } from '@/theme';

type Range = '3' | '6' | '12';

export default function CashFlowScreen() {
  const colors = useAppColors();
  const { home, status } = useMoneyData();
  const { months, loading } = useExploreHistory();
  if (status !== 'ready' || !home) return <ConnectionState />;
  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      testID="cash-flow-screen"
    >
      {months.length ? <CashFlowChart months={months} /> : <Loading loading={loading} />}
    </ScrollView>
  );
}

function CashFlowChart({ months }: { months: ExploreMonth[] }) {
  const colors = useAppColors();
  const [range, setRange] = useState<Range>('6');
  const [selectedMonth, setSelectedMonth] = useState(months.at(-1)!.month);
  const series = months.slice(-Number(range));
  const selected = months.find((month) => month.month === selectedMonth) ?? months.at(-1)!;
  const index = months.findIndex((month) => month.month === selected.month);
  const previous = index > 0 ? months[index - 1] : null;
  const net = overviewCashFlow(selected.income, selected.spending);
  const previousNet = previous ? overviewCashFlow(previous.income, previous.spending) : null;
  const delta = previousNet === null ? null : net - previousNet;
  const max = Math.max(1, ...series.flatMap((month) => [month.income, month.spending]));

  return (
    <>
      <GlassSegmentedControl
        onChange={setRange}
        options={[
          { label: '3M', value: '3' },
          { label: '6M', value: '6' },
          { label: '1Y', value: '12' },
        ]}
        testID="cash-flow-range"
        value={range}
      />

      <Text style={[styles.month, { color: colors.secondary }]}>{monthTitle(selected.month)}</Text>
      <Text
        allowFontScaling={false}
        style={[styles.net, { color: net >= 0 ? colors.positive : colors.danger }]}
        testID="cash-flow-total"
      >
        {formatMoney(net, selected.currencyCode)}
      </Text>
      <Text style={[styles.delta, { color: colors.secondary }]}>
        {delta === null
          ? 'Posted income minus spending'
          : `${formatUnsignedMoney(Math.abs(delta), selected.currencyCode)} ${delta >= 0 ? 'better' : 'worse'} than the previous month`}
      </Text>

      <View style={styles.chart} accessibilityLabel="Income and spending by month">
        {series.map((month) => (
          <Pressable
            accessibilityLabel={`${monthTitle(month.month)}, income ${formatUnsignedMoney(month.income, month.currencyCode)}, spending ${formatUnsignedMoney(month.spending, month.currencyCode)}`}
            accessibilityRole="button"
            key={month.month}
            onPress={() => setSelectedMonth(month.month)}
            style={styles.group}
          >
            <View style={styles.pair}>
              <View
                style={[
                  styles.bar,
                  {
                    backgroundColor: colors.accent,
                    height: Math.max(5, (month.income / max) * 166),
                    opacity: selected.month === month.month ? 1 : 0.76,
                  },
                ]}
              />
              <View
                style={[
                  styles.bar,
                  {
                    backgroundColor: colors.blueSoft,
                    height: Math.max(5, (month.spending / max) * 166),
                    opacity: selected.month === month.month ? 1 : 0.76,
                  },
                ]}
              />
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
        ))}
      </View>

      <View style={styles.legend}>
        <Legend color={colors.accent} label="Posted income" />
        <Legend color={colors.blueSoft} label="Posted spending" />
      </View>
      <View style={[styles.rule, { backgroundColor: colors.separator }]} />
      <View style={styles.breakdown}>
        <Value label="Income" value={formatUnsignedMoney(selected.income, selected.currencyCode)} />
        <Value
          label="Spending"
          value={formatUnsignedMoney(selected.spending, selected.currencyCode)}
        />
      </View>
    </>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  const colors = useAppColors();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.legendText, { color: colors.secondary }]}>{label}</Text>
    </View>
  );
}

function Value({ label, value }: { label: string; value: string }) {
  const colors = useAppColors();
  return (
    <View>
      <Text style={[styles.valueLabel, { color: colors.secondary }]}>{label}</Text>
      <Text allowFontScaling={false} style={[styles.value, { color: colors.text }]}>
        {value}
      </Text>
    </View>
  );
}

function Loading({ loading }: { loading: boolean }) {
  const colors = useAppColors();
  return (
    <View style={styles.loading}>
      {loading ? <ActivityIndicator color={colors.accent} /> : null}
      <Text style={[styles.loadingText, { color: colors.secondary }]}>
        {loading ? 'Loading cash flow…' : 'Cash-flow history is unavailable.'}
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
  month: { marginTop: 28, fontSize: 14, fontWeight: '600' },
  net: {
    marginTop: 3,
    fontSize: 42,
    lineHeight: 49,
    fontWeight: '700',
    letterSpacing: -1.4,
    fontVariant: ['tabular-nums'],
  },
  delta: { marginTop: 6, fontSize: 13, lineHeight: 18 },
  chart: { height: 218, marginTop: 26, flexDirection: 'row', alignItems: 'flex-end', gap: 7 },
  group: { flex: 1, height: 218, alignItems: 'center', justifyContent: 'flex-end' },
  pair: { height: 172, flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  bar: { minWidth: 6, maxWidth: 16, flex: 1, borderRadius: 4 },
  monthLabel: { marginTop: 8, fontSize: 10.5, fontWeight: '600' },
  legend: { marginTop: 14, flexDirection: 'row', gap: 18 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11.5 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 30 },
  breakdown: { flexDirection: 'row', justifyContent: 'space-between' },
  valueLabel: { fontSize: 13 },
  value: { marginTop: 5, fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  loading: { minHeight: 260, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 12, fontSize: 14 },
});
