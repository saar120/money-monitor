import { router, Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ConnectionState } from '@/ConnectionState';
import { GlassSegmentedControl } from '@/GlassSegmentedControl';
import { MonthPicker } from '@/MonthPicker';
import { useActivityTransactions, useExploreHistory, useMoneyData } from '@/MoneyData';
import { formatMoney, formatSpendingChange, formatUnsignedMoney, spendingTotal } from '@/money';
import type { ExploreMonth } from '@/mobile-api';
import { useAppColors } from '@/theme';

export default function CategoryScreen() {
  const colors = useAppColors();
  const { name, month } = useLocalSearchParams<{ name: string; month?: string }>();
  const { home, status } = useMoneyData();
  const { months, loading } = useExploreHistory();
  if (status !== 'ready' || !home) return <ConnectionState />;
  return (
    <>
      <Stack.Screen options={{ title: '' }} />
      {months.length ? (
        <CategoryContent initialMonth={month} months={months} name={name} />
      ) : (
        <View style={[styles.loading, { backgroundColor: colors.background }]}>
          {loading ? <ActivityIndicator color={colors.accent} /> : null}
          <Text style={[styles.empty, { color: colors.secondary }]}>
            {loading ? 'Loading category history…' : 'Category history is unavailable.'}
          </Text>
        </View>
      )}
    </>
  );
}

function CategoryContent({
  initialMonth,
  months,
  name,
}: {
  initialMonth?: string;
  months: ExploreMonth[];
  name: string;
}) {
  const colors = useAppColors();
  const fallback = months.at(-1)!;
  const [range, setRange] = useState<'3' | '6' | '12'>('6');
  const [month, setMonth] = useState(
    months.some((item) => item.month === initialMonth) ? initialMonth! : fallback.month,
  );
  const [windowEndMonth, setWindowEndMonth] = useState(month);
  const snapshot = months.find((item) => item.month === month) ?? fallback;
  const category = snapshot.categories.find((item) => item.name === name);
  const criteria = useMemo(
    () => ({
      category: name,
      startDate: `${snapshot.month}-01`,
      endDate: endOfMonth(snapshot.month),
    }),
    [name, snapshot.month],
  );
  const { transactions } = useActivityTransactions('', 'all', criteria);
  if (!category) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>No {name} spending in this month.</Text>
        <View style={styles.navigatorMissing}>
          <MonthPicker
            month={snapshot.month}
            months={months.map((item) => item.month)}
            onSelect={setMonth}
          />
        </View>
      </View>
    );
  }

  const delta = category.spent - category.previous;
  const merchants = snapshot.merchants
    .filter((merchant) => merchant.category === category.name)
    .sort((a, b) => b.current - b.previous - (a.current - a.previous));
  const merchantRemainder =
    delta - merchants.reduce((total, merchant) => total + merchant.current - merchant.previous, 0);
  const matching = transactions
    .filter((transaction) => transaction.category === category.name)
    .slice(0, 12);
  const selectedIndex = months.findIndex((item) => item.month === windowEndMonth);
  const historyMonths = months.slice(
    Math.max(0, selectedIndex - Number(range) + 1),
    selectedIndex + 1,
  );
  const history = historyMonths.map((item) => ({
    month: item.month,
    total: item.categories.find((candidate) => candidate.name === name)?.spent ?? 0,
  }));
  const chartMaximum = Math.max(1, ...history.map((item) => item.total));
  const total = spendingTotal(category.spent, snapshot.currencyCode);
  const average = history.reduce((sum, item) => sum + item.total, 0) / Math.max(history.length, 1);
  const highestIndex = history.reduce(
    (best, item, index) => (item.total > history[best]!.total ? index : best),
    0,
  );
  const lowestIndex = history.reduce(
    (best, item, index) => (item.total < history[best]!.total ? index : best),
    0,
  );
  const percentOfSpending = snapshot.spending
    ? Math.round((category.spent / snapshot.spending) * 100)
    : 0;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      testID="category-detail"
    >
      <View style={styles.contextRow}>
        <View style={styles.identity}>
          <View style={[styles.identityMark, { backgroundColor: category.color }]} />
          <Text numberOfLines={1} style={[styles.identityName, { color: colors.text }]}>
            {name}
          </Text>
        </View>
        <MonthPicker
          month={snapshot.month}
          months={months.map((item) => item.month)}
          onSelect={(selectedMonth) => {
            setMonth(selectedMonth);
            setWindowEndMonth(selectedMonth);
          }}
          testID="category-month-picker"
        />
      </View>
      <Text
        adjustsFontSizeToFit
        allowFontScaling={false}
        minimumFontScale={0.7}
        numberOfLines={1}
        style={[styles.amount, { color: colors.text }]}
      >
        {total.amount}
      </Text>
      <Text style={[styles.totalLabel, { color: colors.secondary }]}>
        {percentOfSpending}% of total spending · {total.label.toLowerCase()}
      </Text>
      <Text style={[styles.summary, { color: delta > 0 ? colors.warning : colors.positive }]}>
        {delta === 0
          ? 'Unchanged from last month'
          : `${formatSpendingChange(delta, snapshot.currencyCode)} than last month`}
      </Text>

      <View style={styles.rangeRow}>
        <GlassSegmentedControl
          compact
          onChange={setRange}
          options={[
            { label: '3M', value: '3' },
            { label: '6M', value: '6' },
            { label: '1Y', value: '12' },
          ]}
          testID="category-range"
          value={range}
        />
      </View>

      <View style={styles.chart} accessibilityLabel={`${name} spending trend for ${range} months`}>
        <View pointerEvents="none" style={styles.chartGuides}>
          {[0, 1, 2, 3].map((line) => (
            <View key={line} style={[styles.chartGuide, { backgroundColor: colors.separator }]} />
          ))}
        </View>
        <View style={styles.chartBars}>
          {historyMonths.map((item, index) => {
            const selected = item.month === snapshot.month;
            const value = history[index]!.total;
            return (
              <Pressable
                accessibilityLabel={`${item.label}, ${formatUnsignedMoney(value, snapshot.currencyCode)}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={item.month}
                onPress={() => setMonth(item.month)}
                style={({ pressed }) => [styles.chartGroup, { opacity: pressed ? 0.68 : 1 }]}
                testID={`category-bar-${item.month}`}
              >
                <View style={styles.chartTrack}>
                  <View
                    style={[
                      styles.chartBar,
                      {
                        backgroundColor: category.color,
                        height: Math.max(5, (value / chartMaximum) * 136),
                        opacity: selected ? 1 : 0.38,
                      },
                    ]}
                  />
                </View>
                <Text
                  numberOfLines={1}
                  style={[styles.chartLabel, { color: selected ? colors.text : colors.secondary }]}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={[styles.stats, { backgroundColor: colors.surfaceSoft }]}>
        <StatRow
          label="Monthly average"
          value={formatUnsignedMoney(average, snapshot.currencyCode)}
        />
        <StatRow
          label="Highest month"
          value={`${formatUnsignedMoney(history[highestIndex]!.total, snapshot.currencyCode)} (${historyMonths[highestIndex]!.label})`}
        />
        <StatRow
          label="Lowest month"
          value={`${formatUnsignedMoney(history[lowestIndex]!.total, snapshot.currencyCode)} (${historyMonths[lowestIndex]!.label})`}
          last
        />
      </View>

      <Text style={[styles.title, { color: colors.text }]}>Top merchants</Text>
      {merchants.length ? (
        merchants.map((merchant) => {
          const merchantDelta = merchant.current - merchant.previous;
          const merchantTotal = spendingTotal(merchant.current, snapshot.currencyCode);
          return (
            <Pressable
              accessibilityHint={`Opens ${merchant.name} merchant details`}
              accessibilityRole="button"
              key={merchant.name}
              testID={`category-merchant-${merchant.name}`}
              onPress={() =>
                router.push({
                  pathname: '/merchant/[name]',
                  params: { name: merchant.name, month: snapshot.month },
                })
              }
              style={({ pressed }) => [
                styles.row,
                { borderBottomColor: colors.separator, opacity: pressed ? 0.68 : 1 },
              ]}
            >
              <View style={styles.rowText}>
                <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text }]}>
                  {merchant.name}
                </Text>
                <Text style={[styles.rowMeta, { color: colors.secondary }]}>
                  {merchantTotal.amount} {merchantTotal.label.toLowerCase()} · {merchant.count}{' '}
                  transaction{merchant.count === 1 ? '' : 's'}
                </Text>
              </View>
              <View style={styles.trailing}>
                <Text
                  allowFontScaling={false}
                  style={[
                    styles.rowDelta,
                    { color: merchantDelta > 0 ? colors.warning : colors.positive },
                  ]}
                >
                  {formatSpendingChange(merchantDelta, snapshot.currencyCode)}
                </Text>
                <SymbolView name="chevron.right" size={11} tintColor={colors.tertiary} />
              </View>
            </Pressable>
          );
        })
      ) : Math.abs(merchantRemainder) < 1 ? (
        <Text style={[styles.empty, { color: colors.secondary }]}>
          No merchant comparison for this month.
        </Text>
      ) : null}
      {Math.abs(merchantRemainder) >= 1 ? (
        <View style={[styles.row, { borderBottomColor: colors.separator }]}>
          <View style={styles.rowText}>
            <Text style={[styles.rowTitle, { color: colors.text }]}>Other merchants</Text>
            <Text style={[styles.rowMeta, { color: colors.secondary }]}>Combined change</Text>
          </View>
          <Text
            allowFontScaling={false}
            style={[
              styles.rowDelta,
              { color: merchantRemainder > 0 ? colors.warning : colors.positive },
            ]}
          >
            {formatSpendingChange(merchantRemainder, snapshot.currencyCode)}
          </Text>
        </View>
      ) : null}

      <Text style={[styles.title, { color: colors.text }]}>Transactions</Text>
      {matching.length ? (
        matching.map((transaction) => (
          <Pressable
            accessibilityHint="Opens transaction details"
            accessibilityRole="button"
            key={transaction.id}
            onPress={() => router.push(`/transaction/${transaction.id}`)}
            style={[styles.transaction, { borderBottomColor: colors.separator }]}
          >
            <View style={styles.rowText}>
              <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text }]}>
                {transaction.merchant}
              </Text>
              <Text style={[styles.rowMeta, { color: colors.secondary }]}>
                {new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(
                  new Date(transaction.occurredAt),
                )}{' '}
                · {transaction.account}
              </Text>
            </View>
            <Text
              allowFontScaling={false}
              style={[styles.transactionAmount, { color: colors.text }]}
            >
              {formatMoney(
                transaction.amount,
                transaction.currencyCode ?? snapshot.currencyCode,
                true,
              )}
            </Text>
          </Pressable>
        ))
      ) : (
        <Text style={[styles.empty, { color: colors.secondary }]}>
          No matching transactions in this month.
        </Text>
      )}
    </ScrollView>
  );
}

function StatRow({ label, last = false, value }: { label: string; last?: boolean; value: string }) {
  const colors = useAppColors();
  return (
    <View
      style={[
        styles.statRow,
        {
          borderBottomColor: colors.separator,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        },
      ]}
    >
      <Text style={[styles.statLabel, { color: colors.secondary }]}>{label}</Text>
      <Text allowFontScaling={false} style={[styles.statValue, { color: colors.text }]}>
        {value}
      </Text>
    </View>
  );
}

function endOfMonth(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  const day = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  navigatorMissing: { alignSelf: 'stretch', marginTop: 20 },
  contextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  identity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 9 },
  identityMark: { width: 10, height: 36, borderRadius: 5 },
  identityName: { flex: 1, minWidth: 0, fontSize: 17, lineHeight: 22, fontWeight: '700' },
  amount: {
    marginTop: 22,
    fontSize: 42,
    lineHeight: 49,
    fontWeight: '700',
    letterSpacing: -1.4,
    fontVariant: ['tabular-nums'],
  },
  totalLabel: { marginTop: 3, fontSize: 13, lineHeight: 18, fontWeight: '500' },
  summary: { marginTop: 6, fontSize: 15, lineHeight: 21, fontWeight: '600' },
  rangeRow: { marginTop: 22, alignItems: 'center' },
  chart: { height: 166, marginTop: 18, paddingHorizontal: 8 },
  chartGuides: {
    position: 'absolute',
    top: 0,
    right: 8,
    bottom: 24,
    left: 8,
    justifyContent: 'space-between',
  },
  chartGuide: { width: '100%', height: StyleSheet.hairlineWidth },
  chartBars: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  chartGroup: {
    flex: 1,
    minWidth: 0,
    height: 166,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  chartTrack: { width: '100%', height: 142, alignItems: 'center', justifyContent: 'flex-end' },
  chartBar: { width: '62%', minWidth: 10, maxWidth: 38, borderRadius: 5 },
  chartLabel: { marginTop: 6, textAlign: 'center', fontSize: 10.5, fontWeight: '600' },
  stats: { marginTop: 20, paddingHorizontal: 14, borderRadius: 16 },
  statRow: {
    minHeight: 45,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  statLabel: { fontSize: 12.5 },
  statValue: {
    flexShrink: 1,
    textAlign: 'right',
    fontSize: 12.5,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  title: { marginTop: 34, marginBottom: 8, fontSize: 21, lineHeight: 27, fontWeight: '700' },
  row: {
    minHeight: 64,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowText: { flex: 1, minWidth: 0, marginRight: 12 },
  rowTitle: { fontSize: 16, lineHeight: 21, fontWeight: '600', writingDirection: 'ltr' },
  rowMeta: { marginTop: 3, fontSize: 12.5, lineHeight: 17, writingDirection: 'ltr' },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowDelta: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  empty: { marginTop: 10, fontSize: 14, lineHeight: 20 },
  transaction: {
    minHeight: 64,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  transactionAmount: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
