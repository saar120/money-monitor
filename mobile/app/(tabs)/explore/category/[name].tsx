import { CartesianChart, Line } from 'victory-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ConnectionState } from '@/ConnectionState';
import { MonthNavigator } from '@/MonthNavigator';
import { useActivityTransactions, useExploreHistory, useMoneyData } from '@/MoneyData';
import { formatMoney, formatSpendingChange, spendingTotal } from '@/money';
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
      <Stack.Screen options={{ title: name ?? 'Category' }} />
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
  const [month, setMonth] = useState(
    months.some((item) => item.month === initialMonth) ? initialMonth! : fallback.month,
  );
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
          <MonthNavigator months={months} onChange={setMonth} value={snapshot.month} />
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
  const selectedIndex = months.findIndex((item) => item.month === snapshot.month);
  const history = months
    .slice(Math.max(0, selectedIndex - 5), selectedIndex + 1)
    .map((item, index) => ({
      index,
      total: item.categories.find((candidate) => candidate.name === name)?.spent ?? 0,
    }));
  const total = spendingTotal(category.spent, snapshot.currencyCode);

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      testID="category-detail"
    >
      <MonthNavigator months={months} onChange={setMonth} value={snapshot.month} />
      <Text
        adjustsFontSizeToFit
        allowFontScaling={false}
        minimumFontScale={0.7}
        numberOfLines={1}
        style={[styles.amount, { color: colors.text }]}
      >
        {total.amount}
      </Text>
      <Text style={[styles.totalLabel, { color: colors.secondary }]}>{total.label}</Text>
      <Text style={[styles.summary, { color: delta > 0 ? colors.warning : colors.positive }]}>
        {delta === 0
          ? 'Unchanged from last month'
          : `${formatSpendingChange(delta, snapshot.currencyCode)} than last month`}
      </Text>

      <View style={styles.chart} accessibilityLabel={`${name} spending trend for six months`}>
        <CartesianChart
          data={history}
          xKey="index"
          yKeys={['total']}
          domainPadding={{ top: 18, bottom: 8 }}
        >
          {({ points }) => (
            <Line
              points={points.total}
              color={category.color}
              curveType="natural"
              strokeWidth={3}
            />
          )}
        </CartesianChart>
      </View>
      <View style={styles.chartLabels}>
        <Text style={[styles.chartLabel, { color: colors.secondary }]}>6 months ago</Text>
        <Text style={[styles.chartLabel, { color: colors.secondary }]}>{snapshot.label}</Text>
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

function endOfMonth(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  const day = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  navigatorMissing: { alignSelf: 'stretch', marginTop: 20 },
  amount: {
    marginTop: 24,
    fontSize: 42,
    lineHeight: 49,
    fontWeight: '700',
    letterSpacing: -1.4,
    fontVariant: ['tabular-nums'],
  },
  totalLabel: { marginTop: 3, fontSize: 13, lineHeight: 18, fontWeight: '500' },
  summary: { marginTop: 6, fontSize: 15, lineHeight: 21, fontWeight: '600' },
  chart: { height: 150, marginTop: 24 },
  chartLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  chartLabel: { fontSize: 11.5 },
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
