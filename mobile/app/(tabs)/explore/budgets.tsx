import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { ConnectionState } from '@/ConnectionState';
import { MonthPicker } from '@/MonthPicker';
import { useActivityTransactions, useExploreHistory, useMoneyData } from '@/MoneyData';
import { formatMoney, formatUnsignedMoney } from '@/money';
import type { ExploreMonth } from '@/mobile-api';
import { useAppColors } from '@/theme';

export default function BudgetsScreen() {
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
      testID="budgets-screen"
    >
      {months.length ? (
        <BudgetList initialMonth={month} months={months} />
      ) : (
        <Loading loading={loading} />
      )}
    </ScrollView>
  );
}

function BudgetList({ initialMonth, months }: { initialMonth?: string; months: ExploreMonth[] }) {
  const colors = useAppColors();
  const [month, setMonth] = useState(
    months.some((item) => item.month === initialMonth) ? initialMonth! : months.at(-1)!.month,
  );
  const [expanded, setExpanded] = useState<string | null>(null);
  const selected = months.find((item) => item.month === month) ?? months.at(-1)!;
  return (
    <>
      <View style={styles.contextRow}>
        <Text style={[styles.contextLabel, { color: colors.secondary }]}>
          Tap a budget for transactions
        </Text>
        <MonthPicker
          month={selected.month}
          months={months.map((item) => item.month)}
          onSelect={(value) => {
            setMonth(value);
            setExpanded(null);
          }}
          testID="budgets-month-picker"
        />
      </View>
      {selected.budgets.length ? (
        <View style={styles.list}>
          {selected.budgets.map((budget) => {
            const statusColor =
              budget.status === 'over_budget'
                ? colors.danger
                : budget.status === 'watch'
                  ? colors.warning
                  : colors.positive;
            const isExpanded = expanded === budget.name;
            return (
              <View key={budget.name}>
                <Pressable
                  accessibilityHint="Shows the transactions counted in this budget"
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isExpanded }}
                  onPress={() => setExpanded(isExpanded ? null : budget.name)}
                  style={({ pressed }) => [
                    styles.row,
                    { borderBottomColor: colors.separator, opacity: pressed ? 0.64 : 1 },
                  ]}
                  testID={`budget-row-${budget.name}`}
                >
                  <View style={styles.heading}>
                    <View style={styles.copy}>
                      <Text style={[styles.name, { color: colors.text }]}>{budget.name}</Text>
                      <Text style={[styles.meta, { color: colors.secondary }]}>
                        {formatUnsignedMoney(budget.spent, selected.currencyCode)} of{' '}
                        {formatUnsignedMoney(budget.limit, selected.currencyCode)}
                      </Text>
                    </View>
                    <View style={styles.trailing}>
                      <View style={styles.percentRow}>
                        <Text
                          allowFontScaling={false}
                          style={[styles.percent, { color: statusColor }]}
                        >
                          {Math.round(budget.usedPercent)}%
                        </Text>
                        <SymbolView
                          name={isExpanded ? 'chevron.up' : 'chevron.down'}
                          size={10}
                          tintColor={colors.tertiary}
                        />
                      </View>
                      <Text style={[styles.remaining, { color: colors.secondary }]}>
                        {formatUnsignedMoney(Math.abs(budget.remaining), selected.currencyCode)}{' '}
                        {budget.remaining < 0 ? 'over' : 'left'}
                      </Text>
                    </View>
                  </View>
                  <View style={[styles.track, { backgroundColor: colors.separator }]}>
                    <View
                      style={[
                        styles.fill,
                        {
                          backgroundColor: statusColor,
                          width: `${Math.min(100, budget.usedPercent)}%`,
                        },
                      ]}
                    />
                    <View
                      style={[
                        styles.elapsed,
                        {
                          backgroundColor: colors.secondary,
                          left: `${Math.min(100, budget.elapsedPercent)}%`,
                        },
                      ]}
                    />
                  </View>
                  <Text style={[styles.pace, { color: colors.secondary }]}>
                    Month {Math.round(budget.elapsedPercent)}% elapsed
                  </Text>
                </Pressable>
                {isExpanded ? (
                  budget.categoryNames === null ? (
                    <View style={[styles.transactions, { backgroundColor: colors.surfaceSoft }]}>
                      <Text style={[styles.noTransactions, { color: colors.secondary }]}>
                        Update Money Monitor on your Mac to load this budget’s transactions.
                      </Text>
                    </View>
                  ) : (
                    <BudgetTransactions
                      categories={budget.categoryNames}
                      currencyCode={selected.currencyCode}
                      month={selected.month}
                    />
                  )
                ) : null}
              </View>
            );
          })}
        </View>
      ) : (
        <View style={[styles.empty, { backgroundColor: colors.surfaceSoft }]}>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No budgets for this month</Text>
          <Text style={[styles.emptyText, { color: colors.secondary }]}>
            Budget setup stays on your Mac.
          </Text>
        </View>
      )}
    </>
  );
}

function BudgetTransactions({
  categories,
  currencyCode,
  month,
}: {
  categories: string[];
  currencyCode: string;
  month: string;
}) {
  const colors = useAppColors();
  const reduceMotion = useReducedMotion();
  const criteria = useMemo(
    () => ({
      ...(categories.length ? { categories } : {}),
      direction: 'debit' as const,
      startDate: `${month}-01`,
      endDate: endOfMonth(month),
    }),
    [categories, month],
  );
  const { error, hasMore, loadMore, loading, loadingMore, transactions } =
    useActivityTransactions('', 'all', criteria, true);
  const visible = transactions.filter((item) => item.included);

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeInDown.duration(190)}
      style={[styles.transactions, { backgroundColor: colors.surfaceSoft }]}
    >
      <Text style={[styles.transactionsTitle, { color: colors.text }]}>Transactions</Text>
      {loading ? (
        <ActivityIndicator color={colors.accent} style={styles.transactionLoader} />
      ) : null}
      {!loading && error ? (
        <Text style={[styles.noTransactions, { color: colors.danger }]}>{error}</Text>
      ) : null}
      {!loading && !error && !visible.length ? (
        <Text style={[styles.noTransactions, { color: colors.secondary }]}>
          No matching transactions this month.
        </Text>
      ) : null}
      {visible.map((transaction, index) => (
        <Pressable
          accessibilityHint="Opens transaction details"
          accessibilityRole="button"
          key={transaction.id}
          onPress={() => router.push(`/transaction/${transaction.id}`)}
          style={({ pressed }) => [
            styles.transaction,
            {
              borderBottomColor: colors.separator,
              borderBottomWidth: index === visible.length - 1 ? 0 : StyleSheet.hairlineWidth,
              opacity: pressed ? 0.62 : 1,
            },
          ]}
        >
          <View style={styles.transactionCopy}>
            <Text numberOfLines={1} style={[styles.transactionMerchant, { color: colors.text }]}>
              {transaction.merchant}
            </Text>
            <Text style={[styles.transactionMeta, { color: colors.secondary }]}>
              {new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(
                new Date(transaction.occurredAt),
              )}{' '}
              · {transaction.account}
            </Text>
          </View>
          <Text allowFontScaling={false} style={[styles.transactionAmount, { color: colors.text }]}>
            {formatMoney(transaction.amount, transaction.currencyCode ?? currencyCode, true)}
          </Text>
          <SymbolView name="chevron.right" size={9} tintColor={colors.tertiary} />
        </Pressable>
      ))}
      {hasMore && visible.length ? (
        <Pressable
          accessibilityRole="button"
          disabled={loadingMore}
          onPress={loadMore}
          style={({ pressed }) => [styles.loadMore, { opacity: pressed ? 0.62 : 1 }]}
        >
          {loadingMore ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <Text style={[styles.loadMoreText, { color: colors.accent }]}>Load more</Text>
          )}
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

function endOfMonth(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  const day = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, '0')}`;
}

function Loading({ loading }: { loading: boolean }) {
  const colors = useAppColors();
  return (
    <View style={styles.loading}>
      {loading ? <ActivityIndicator color={colors.accent} /> : null}
      <Text style={[styles.loadingText, { color: colors.secondary }]}>
        {loading ? 'Loading budgets…' : 'Budget history is unavailable.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  contextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  contextLabel: { flex: 1, fontSize: 12.5, lineHeight: 18 },
  list: { marginTop: 16 },
  row: { paddingVertical: 22, borderBottomWidth: StyleSheet.hairlineWidth },
  heading: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  copy: { flex: 1, minWidth: 0 },
  name: { fontSize: 17, lineHeight: 22, fontWeight: '700' },
  meta: { marginTop: 4, fontSize: 12.5, lineHeight: 17 },
  trailing: { alignItems: 'flex-end' },
  percentRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  percent: { fontSize: 19, lineHeight: 23, fontWeight: '700', fontVariant: ['tabular-nums'] },
  remaining: { marginTop: 3, fontSize: 11.5 },
  track: { height: 8, marginTop: 16, borderRadius: 4 },
  fill: { height: 8, borderRadius: 4 },
  elapsed: { position: 'absolute', top: -2, width: 2, height: 12, borderRadius: 1 },
  pace: { marginTop: 8, fontSize: 11.5 },
  transactions: { marginVertical: 10, paddingHorizontal: 14, borderRadius: 16 },
  transactionsTitle: {
    paddingTop: 14,
    paddingBottom: 6,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  transactionLoader: { marginVertical: 20 },
  noTransactions: { paddingVertical: 16, fontSize: 13, lineHeight: 18 },
  transaction: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 9 },
  transactionCopy: { flex: 1, minWidth: 0 },
  transactionMerchant: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '600',
    writingDirection: 'ltr',
  },
  transactionMeta: { marginTop: 2, fontSize: 11, lineHeight: 15, writingDirection: 'ltr' },
  transactionAmount: {
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  loadMore: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  loadMoreText: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  empty: { marginTop: 24, padding: 20, borderRadius: 18 },
  emptyTitle: { fontSize: 17, fontWeight: '700' },
  emptyText: { marginTop: 5, fontSize: 13, lineHeight: 18 },
  loading: { minHeight: 260, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 12, fontSize: 14 },
});
