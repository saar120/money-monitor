import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useActivityTransactions, useMoneyData } from '@/MoneyData';
import { formatMoney, formatUnsignedMoney } from '@/money';
import { useAppColors } from '@/theme';

export default function MerchantScreen() {
  const colors = useAppColors();
  const { name } = useLocalSearchParams<{ name: string }>();
  const { home } = useMoneyData();
  const { transactions } = useActivityTransactions(name ?? '', 'all');
  const merchant = home?.merchants.find((item) => item.name === name);
  if (!home) return null;
  const delta = merchant ? merchant.current - merchant.previous : null;
  return (
    <>
      <Stack.Screen options={{ title: name ?? 'Merchant' }} />
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
      >
        {merchant ? (
          <>
            <Text style={[styles.amount, { color: colors.text }]}>
              {formatUnsignedMoney(merchant.current, home.currencyCode)}
            </Text>
            <Text style={[styles.summary, { color: delta! > 0 ? colors.warning : colors.accent }]}>
              {formatMoney(delta!, home.currencyCode)} compared with last month
            </Text>
            <Text style={[styles.meta, { color: colors.secondary }]}>
              {merchant.category} · {merchant.count} transaction{merchant.count === 1 ? '' : 's'}
            </Text>
          </>
        ) : null}
        <Text style={[styles.title, { color: colors.text }]}>Transactions</Text>
        {transactions.length ? (
          transactions.map((transaction) => (
            <Pressable
              key={transaction.id}
              onPress={() => router.push(`/(tabs)/activity/${transaction.id}`)}
              style={styles.row}
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
              <Text style={[styles.rowAmount, { color: colors.text }]}>
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
  content: { paddingHorizontal: 20, paddingBottom: 48 },
  amount: {
    marginTop: 18,
    fontSize: 42,
    lineHeight: 49,
    fontWeight: '700',
    letterSpacing: -1.4,
    fontVariant: ['tabular-nums'],
  },
  summary: { marginTop: 6, fontSize: 15, lineHeight: 21, fontWeight: '600' },
  meta: { marginTop: 5, fontSize: 13 },
  title: { marginTop: 36, marginBottom: 8, fontSize: 21, lineHeight: 27, fontWeight: '700' },
  row: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 16, lineHeight: 21, fontWeight: '600', writingDirection: 'auto' },
  rowMeta: { marginTop: 3, fontSize: 12.5, writingDirection: 'auto' },
  rowAmount: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  empty: { marginTop: 10, fontSize: 14 },
});
