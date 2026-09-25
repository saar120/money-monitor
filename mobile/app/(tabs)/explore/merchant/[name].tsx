import { t } from '@/localization';
import { currentLocale } from '@/locale-state';
import { Text } from '@/LocalizedText';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ConnectionState } from '@/ConnectionState';
import { MonthPicker } from '@/MonthPicker';
import { useActivityTransactions, useExploreHistory, useMoneyData } from '@/MoneyData';
import { formatMoney, formatSpendingComparison, spendingTotal } from '@/money';
import type { ExploreMonth } from '@/mobile-api';
import { useAppColors } from '@/theme';

export default function MerchantScreen() {
  const colors = useAppColors();
  const { name, month } = useLocalSearchParams<{ name: string; month?: string }>();
  const { home, status } = useMoneyData();
  const { months, loading } = useExploreHistory();
  if (status !== 'ready' || !home) return <ConnectionState />;
  return (
    <>
      <Stack.Screen options={{ title: name ?? t('merchant') }} />
      {months.length ? (
        <MerchantContent initialMonth={month} months={months} name={name} />
      ) : (
        <View style={[styles.loading, { backgroundColor: colors.background }]}>
          {loading ? <ActivityIndicator color={colors.accent} /> : null}
          <Text style={[styles.empty, { color: colors.secondary }]}>
            {loading ? t('loadingMerchantHistory') : t('merchantHistoryIsUnavailable')}
          </Text>
        </View>
      )}
    </>
  );
}

function MerchantContent({
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
  const merchant = snapshot.merchants.find((item) => item.name === name);
  const criteria = useMemo(
    () => ({ startDate: `${snapshot.month}-01`, endDate: endOfMonth(snapshot.month) }),
    [snapshot.month],
  );
  const { transactions, loading, error } = useActivityTransactions(name ?? '', 'all', criteria);
  const delta = merchant ? merchant.current - merchant.previous : null;
  const total = merchant ? spendingTotal(merchant.current, snapshot.currencyCode) : null;
  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      testID="merchant-detail"
    >
      <View style={styles.monthRow}>
        <MonthPicker
          month={snapshot.month}
          months={months.map((item) => item.month)}
          onSelect={setMonth}
          testID="merchant-month-picker"
        />
      </View>
      {merchant ? (
        <>
          <Text
            adjustsFontSizeToFit
            allowFontScaling={false}
            minimumFontScale={0.7}
            numberOfLines={1}
            style={[styles.amount, { color: colors.text }]}
          >
            {total!.amount}
          </Text>
          <Text style={[styles.totalLabel, { color: colors.secondary }]}>{total!.label}</Text>
          <Text style={[styles.summary, { color: delta! > 0 ? colors.warning : colors.positive }]}>
            {delta === 0
              ? t('unchangedFromLastMonth')
              : formatSpendingComparison(delta!, snapshot.currencyCode)}
          </Text>
          <Text style={[styles.meta, { color: colors.secondary }]}>
            {merchant.category} · {t('transactionCount', { count: merchant.count })}
          </Text>
        </>
      ) : (
        <View style={[styles.noSpend, { backgroundColor: colors.surfaceSoft }]}>
          <Text style={[styles.noSpendTitle, { color: colors.text }]}>
            {t('noSpendingThisMonth')}
          </Text>
          <Text style={[styles.meta, { color: colors.secondary }]}>
            {t('useTheArrowsToInspectAnotherMonth')}
          </Text>
        </View>
      )}
      <Text style={[styles.title, { color: colors.text }]}>{t('transactions')}</Text>
      {loading ? (
        <ActivityIndicator color={colors.accent} style={styles.transactionLoading} />
      ) : error ? (
        <Text style={[styles.empty, { color: colors.danger }]}>{error}</Text>
      ) : transactions.length ? (
        transactions.map((transaction) => (
          <Pressable
            accessibilityHint={t('opensTransactionDetails')}
            accessibilityRole="button"
            key={transaction.id}
            onPress={() => router.push(`/transaction/${transaction.id}`)}
            style={({ pressed }) => [
              styles.row,
              { borderBottomColor: colors.separator, opacity: pressed ? 0.68 : 1 },
            ]}
          >
            <View style={styles.rowText}>
              <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text }]}>
                {transaction.merchant}
              </Text>
              <Text style={[styles.rowMeta, { color: colors.secondary }]}>
                {new Intl.DateTimeFormat(currentLocale(), {
                  month: 'short',
                  day: 'numeric',
                }).format(new Date(transaction.occurredAt))}{' '}
                · {transaction.account}
              </Text>
            </View>
            <Text allowFontScaling={false} style={[styles.rowAmount, { color: colors.text }]}>
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
          {t('noMatchingTransactionsInThisMonth')}
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
  monthRow: { alignItems: 'flex-end' },
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
  meta: { marginTop: 5, fontSize: 13, lineHeight: 18 },
  noSpend: { marginTop: 24, padding: 20, borderRadius: 18 },
  noSpendTitle: { fontSize: 17, fontWeight: '700' },
  title: { marginTop: 36, marginBottom: 8, fontSize: 21, lineHeight: 27, fontWeight: '700' },
  row: {
    minHeight: 66,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 16, lineHeight: 21, fontWeight: '600' },
  rowMeta: { marginTop: 3, fontSize: 12.5, lineHeight: 17 },
  rowAmount: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  empty: { marginTop: 10, fontSize: 14, lineHeight: 20 },
  transactionLoading: { alignSelf: 'flex-start', marginTop: 14 },
});
