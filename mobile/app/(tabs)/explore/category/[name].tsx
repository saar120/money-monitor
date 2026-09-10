import { router, Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ConnectionState } from '@/ConnectionState';
import { useActivityTransactions, useMoneyData } from '@/MoneyData';
import { formatMoney, formatUnsignedMoney } from '@/money';
import { useAppColors } from '@/theme';

export default function CategoryScreen() {
  const colors = useAppColors();
  const { name } = useLocalSearchParams<{ name: string }>();
  const { home, status } = useMoneyData();
  const { transactions } = useActivityTransactions('', 'all', name);
  const category = home?.categories.find((item) => item.name === name);
  if (status !== 'ready' || !home) return <ConnectionState />;
  if (!category)
    return (
      <View style={[styles.missing, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>Category unavailable</Text>
      </View>
    );
  const delta = category.spent - category.previous;
  const merchants = home.merchants
    .filter((merchant) => merchant.category === category.name)
    .sort((a, b) => b.current - b.previous - (a.current - a.previous));
  const merchantRemainder =
    delta - merchants.reduce((total, merchant) => total + merchant.current - merchant.previous, 0);
  const matching = transactions
    .filter((transaction) => transaction.category === category.name)
    .slice(0, 12);

  return (
    <>
      <Stack.Screen options={{ title: category.name }} />
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
      >
        <Text
          adjustsFontSizeToFit
          allowFontScaling={false}
          minimumFontScale={0.7}
          numberOfLines={1}
          style={[styles.amount, { color: colors.text }]}
        >
          {formatUnsignedMoney(category.spent, home.currencyCode)}
        </Text>
        <Text style={[styles.summary, { color: delta > 0 ? colors.warning : colors.accent }]}>
          {delta === 0
            ? 'Unchanged from last month'
            : `${formatMoney(delta, home.currencyCode)} compared with this point last month`}
        </Text>

        <Text style={[styles.title, { color: colors.text }]}>What caused the change?</Text>
        {merchants.length ? (
          merchants.map((merchant) => {
            const merchantDelta = merchant.current - merchant.previous;
            return (
              <Pressable
                accessibilityHint={`Opens ${merchant.name} merchant details`}
                accessibilityRole="button"
                key={merchant.name}
                testID={`category-merchant-${merchant.name}`}
                onPress={() =>
                  router.push({
                    pathname: '/(tabs)/explore/merchant/[name]',
                    params: { name: merchant.name },
                  })
                }
                style={styles.row}
              >
                <View style={styles.rowText}>
                  <Text
                    maxFontSizeMultiplier={1.5}
                    numberOfLines={1}
                    style={[styles.rowTitle, { color: colors.text }]}
                  >
                    {merchant.name}
                  </Text>
                  <Text
                    maxFontSizeMultiplier={1.4}
                    style={[styles.rowMeta, { color: colors.secondary }]}
                  >
                    {formatUnsignedMoney(merchant.current, home.currencyCode)} · {merchant.count}{' '}
                    transaction{merchant.count === 1 ? '' : 's'}
                  </Text>
                </View>
                <View style={styles.trailing}>
                  <Text
                    allowFontScaling={false}
                    style={[
                      styles.delta,
                      { color: merchantDelta > 0 ? colors.warning : colors.accent },
                    ]}
                  >
                    {formatMoney(merchantDelta, home.currencyCode)}
                  </Text>
                  <SymbolView name="chevron.right" size={11} tintColor={colors.tertiary} />
                </View>
              </Pressable>
            );
          })
        ) : Math.abs(merchantRemainder) < 1 ? (
          <Text style={[styles.empty, { color: colors.secondary }]}>
            Merchant comparison is not available for this category yet.
          </Text>
        ) : null}
        {Math.abs(merchantRemainder) >= 1 ? (
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, { color: colors.text }]}>Other merchants</Text>
              <Text style={[styles.rowMeta, { color: colors.secondary }]}>Combined change</Text>
            </View>
            <Text
              allowFontScaling={false}
              style={[
                styles.delta,
                { color: merchantRemainder > 0 ? colors.warning : colors.accent },
              ]}
            >
              {formatMoney(merchantRemainder, home.currencyCode)}
            </Text>
          </View>
        ) : null}

        <Text style={[styles.title, { color: colors.text }]}>Transactions</Text>
        {matching.map((transaction) => (
          <Pressable
            accessibilityHint="Opens transaction details"
            accessibilityRole="button"
            key={transaction.id}
            onPress={() => router.push(`/(tabs)/activity/${transaction.id}`)}
            style={styles.transaction}
          >
            <View style={styles.transactionText}>
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
              style={[styles.transactionAmount, { color: colors.text }]}
            >
              {formatMoney(transaction.amount, transaction.currencyCode ?? home.currencyCode, true)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 48 },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  amount: {
    marginTop: 18,
    fontSize: 42,
    lineHeight: 49,
    fontWeight: '700',
    letterSpacing: -1.4,
    fontVariant: ['tabular-nums'],
  },
  summary: { marginTop: 6, fontSize: 15, lineHeight: 21, fontWeight: '600' },
  title: { marginTop: 36, marginBottom: 8, fontSize: 21, lineHeight: 27, fontWeight: '700' },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowText: { flex: 1, minWidth: 0, marginRight: 12 },
  rowTitle: { fontSize: 16, lineHeight: 21, fontWeight: '600', writingDirection: 'ltr' },
  rowMeta: { marginTop: 3, fontSize: 12.5, writingDirection: 'ltr' },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  delta: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  empty: { marginTop: 8, fontSize: 14, lineHeight: 20 },
  transaction: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12 },
  transactionText: { flex: 1, minWidth: 0 },
  transactionAmount: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
