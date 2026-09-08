import { Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ConnectionState } from '@/ConnectionState';
import { useMoneyData, useTransaction } from '@/MoneyData';
import { formatMoney } from '@/money';
import { useAppColors } from '@/theme';

export default function TransactionDetailScreen() {
  const colors = useAppColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const money = useMoneyData();
  const result = useTransaction(id);
  const transaction = result.transaction;

  if (money.status !== 'ready') return <ConnectionState />;

  if (result.loading) {
    return (
      <View style={[styles.missing, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={[styles.missingBody, { color: colors.secondary }]}>
          Loading transaction from your Mac…
        </Text>
      </View>
    );
  }

  if (!transaction) {
    return (
      <View style={[styles.missing, { backgroundColor: colors.background }]}>
        <Text style={[styles.missingTitle, { color: colors.text }]}>Transaction unavailable</Text>
        <Text style={[styles.missingBody, { color: colors.secondary }]}>
          {result.error ?? 'This transaction is no longer available.'}
        </Text>
      </View>
    );
  }

  const date = new Intl.DateTimeFormat('en', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    ...(money.source === 'fixture' ? { hour: 'numeric', minute: '2-digit' } : {}),
  }).format(new Date(transaction.occurredAt));

  return (
    <>
      <Stack.Screen options={{ title: transaction.merchant }} />
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        testID="transaction-detail"
      >
        <View style={styles.hero}>
          <Text
            style={[styles.amount, { color: transaction.amount > 0 ? colors.accent : colors.text }]}
          >
            {formatMoney(transaction.amount, transaction.currencyCode, true)}
          </Text>
          <Text style={[styles.merchant, { color: colors.text }]}>{transaction.merchant}</Text>
          <Text style={[styles.description, { color: colors.secondary }]}>
            {transaction.description ?? date}
          </Text>
          <View style={styles.flags}>
            {transaction.pending ? (
              <DetailFlag label="Pending" color={colors.warning} background={colors.warningSoft} />
            ) : null}
            {transaction.needsReview ? (
              <DetailFlag
                label="Needs review"
                color={colors.danger}
                background={colors.dangerSoft}
              />
            ) : null}
          </View>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.secondary }]}>TRANSACTION</Text>
        <View style={[styles.group, { backgroundColor: colors.surface }]}>
          <DetailRow label="Date" value={date} />
          <DetailRow label="Account" value={transaction.account} />
          <DetailRow label="Description" value={transaction.description ?? '—'} last />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.secondary }]}>MONEY MONITOR</Text>
        <View style={[styles.group, { backgroundColor: colors.surface }]}>
          <DetailRow label="Category" value={transaction.category} symbol="tag" />
          <DetailRow label="Owner" value={transaction.owner} symbol="person" />
          <DetailRow
            label="Included"
            value={transaction.included ? 'Included in reports' : 'Excluded'}
            symbol="checkmark.circle"
          />
          <DetailRow label="Effective date" value={transaction.effectiveDate} symbol="calendar" />
          <DetailRow
            label="Review"
            value={transaction.needsReview ? 'Needs review' : 'Reviewed'}
            symbol="checkmark.seal"
            last
          />
        </View>
      </ScrollView>
    </>
  );
}

function DetailRow({
  label,
  value,
  symbol,
  last = false,
}: {
  label: string;
  value: string;
  symbol?: Parameters<typeof SymbolView>[0]['name'];
  last?: boolean;
}) {
  const colors = useAppColors();
  return (
    <View style={styles.detailRow}>
      {symbol ? (
        <SymbolView name={symbol} size={17} tintColor={colors.secondary} style={styles.rowIcon} />
      ) : null}
      <View
        style={[
          styles.detailRowBody,
          !last && {
            borderBottomColor: colors.separator,
            borderBottomWidth: StyleSheet.hairlineWidth,
          },
        ]}
      >
        <Text style={[styles.detailLabel, { color: colors.text }]}>{label}</Text>
        <Text numberOfLines={2} style={[styles.detailValue, { color: colors.secondary }]}>
          {value}
        </Text>
      </View>
    </View>
  );
}

function DetailFlag({
  label,
  color,
  background,
}: {
  label: string;
  color: string;
  background: string;
}) {
  return (
    <View style={[styles.flag, { backgroundColor: background }]}>
      <Text style={[styles.flagText, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  hero: { alignItems: 'center', paddingTop: 26, paddingBottom: 34, paddingHorizontal: 20 },
  amount: {
    fontSize: 39,
    lineHeight: 46,
    fontWeight: '700',
    letterSpacing: -1.2,
    fontVariant: ['tabular-nums'],
  },
  merchant: {
    marginTop: 10,
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '600',
    textAlign: 'center',
    writingDirection: 'auto',
  },
  description: { marginTop: 4, fontSize: 14, textAlign: 'center', writingDirection: 'auto' },
  flags: { flexDirection: 'row', gap: 7, marginTop: 14 },
  flag: {
    minHeight: 27,
    borderRadius: 8,
    paddingHorizontal: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flagText: { fontSize: 12, fontWeight: '700' },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 16,
    marginBottom: 7,
    marginTop: 23,
    letterSpacing: 0.25,
  },
  group: { borderRadius: 12, overflow: 'hidden' },
  detailRow: { minHeight: 52, flexDirection: 'row', paddingLeft: 16 },
  rowIcon: { width: 22, marginRight: 8, alignSelf: 'center' },
  detailRowBody: {
    flex: 1,
    minHeight: 52,
    paddingRight: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  detailLabel: { flex: 0.42, fontSize: 15 },
  detailValue: { flex: 0.58, fontSize: 15, textAlign: 'right', writingDirection: 'auto' },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  missingTitle: { fontSize: 21, fontWeight: '700' },
  missingBody: { marginTop: 8, fontSize: 15, textAlign: 'center' },
});
