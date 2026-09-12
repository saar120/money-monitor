import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ConnectionState } from '@/ConnectionState';
import { useActivityTransactions, useMoneyData } from '@/MoneyData';
import { formatMoney, formatSpendingChange, spendingTotal } from '@/money';
import { useAppColors } from '@/theme';

export default function MerchantScreen() {
  const colors = useAppColors();
  const { name } = useLocalSearchParams<{ name: string }>();
  const { home, status } = useMoneyData();
  const { transactions, loading, error } = useActivityTransactions(name ?? '', 'all');
  const merchant = home?.merchants.find((item) => item.name === name);
  if (status !== 'ready' || !home) return <ConnectionState />;
  const delta = merchant ? merchant.current - merchant.previous : null;
  const total = merchant ? spendingTotal(merchant.current, home.currencyCode) : null;
  return (
    <>
      <Stack.Screen options={{ title: name ?? 'Merchant' }} />
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        testID="merchant-detail"
      >
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
            <Text style={[styles.totalLabel, { color: colors.secondary }]}>
              {total!.label} this month
            </Text>
            <Text
              style={[styles.summary, { color: delta! > 0 ? colors.warning : colors.positive }]}
            >
              {delta === 0
                ? 'Unchanged from last month'
                : `${formatSpendingChange(delta!, home.currencyCode)} than last month`}
            </Text>
            <Text style={[styles.meta, { color: colors.secondary }]}>
              {merchant.category} · {merchant.count} transaction{merchant.count === 1 ? '' : 's'}
            </Text>
          </>
        ) : null}
        <Text style={[styles.title, { color: colors.text }]}>Transactions</Text>
        {loading ? (
          <ActivityIndicator color={colors.accent} style={styles.loading} />
        ) : error ? (
          <Text style={[styles.empty, { color: colors.danger }]}>{error}</Text>
        ) : transactions.length ? (
          transactions.map((transaction) => (
            <Pressable
              accessibilityHint="Opens transaction details"
              accessibilityRole="button"
              key={transaction.id}
              onPress={() => router.push(`/transaction/${transaction.id}`)}
              style={[styles.row, { borderBottomColor: colors.separator }]}
            >
              <View style={styles.rowText}>
                <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text }]}>
                  {transaction.merchant}
                </Text>
                <Text
                  maxFontSizeMultiplier={1.4}
                  style={[styles.rowMeta, { color: colors.secondary }]}
                >
                  {new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(
                    new Date(transaction.occurredAt),
                  )}{' '}
                  · {transaction.account}
                </Text>
              </View>
              <Text
                adjustsFontSizeToFit
                allowFontScaling={false}
                minimumFontScale={0.75}
                numberOfLines={1}
                style={[styles.rowAmount, { color: colors.text }]}
              >
                {formatMoney(
                  transaction.amount,
                  transaction.currencyCode ?? home.currencyCode,
                  true,
                )}
              </Text>
            </Pressable>
          ))
        ) : (
          <Text style={[styles.empty, { color: colors.secondary }]}>
            No matching transactions in this period.
          </Text>
        )}
      </ScrollView>
    </>
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
  totalLabel: { marginTop: 3, fontSize: 13, lineHeight: 18, fontWeight: '500' },
  summary: { marginTop: 5, fontSize: 15, lineHeight: 21, fontWeight: '600' },
  meta: { marginTop: 5, fontSize: 13 },
  title: { marginTop: 36, marginBottom: 8, fontSize: 21, lineHeight: 27, fontWeight: '700' },
  row: {
    minHeight: 66,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 16, lineHeight: 21, fontWeight: '600', writingDirection: 'ltr' },
  rowMeta: { marginTop: 3, fontSize: 12.5, writingDirection: 'ltr' },
  rowAmount: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  empty: { marginTop: 10, fontSize: 14 },
  loading: { alignSelf: 'flex-start', marginTop: 14 },
});
