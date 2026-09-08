import { Stack, router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ConnectionState } from '@/ConnectionState';
import { useActivityTransactions, useMoneyData } from '@/MoneyData';
import { formatMoney } from '@/money';
import type { Transaction } from '@/fixtures';
import type { ActivityFilter } from '@/mobile-api';
import { useAppColors } from '@/theme';

const filters: Array<{ key: ActivityFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'review', label: 'Needs review' },
  { key: 'pending', label: 'Pending' },
  { key: 'credits', label: 'Credits' },
];

export default function ActivityScreen() {
  const colors = useAppColors();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const money = useMoneyData();
  const result = useActivityTransactions(query, filter);
  const transactions = result.transactions;
  const currentDate = money.home?.currentDate ?? new Date().toISOString().slice(0, 10);
  const month = money.home?.month ?? '';

  const sections = useMemo(
    () => groupTransactions(transactions, currentDate, money.source === 'fixture'),
    [currentDate, money.source, transactions],
  );

  if (money.status !== 'ready' || !money.home) return <ConnectionState />;

  return (
    <>
      <Stack.Screen
        options={{
          headerSearchBarOptions: {
            placeholder: 'Merchant, category, or account',
            hideWhenScrolling: false,
            onChangeText: (event) => setQuery(event.nativeEvent.text),
            onCancelButtonPress: () => setQuery(''),
          },
        }}
      />
      <SectionList
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        stickySectionHeadersEnabled
        keyboardDismissMode="on-drag"
        sections={sections}
        keyExtractor={(item) => item.id}
        testID="activity-screen"
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={() => void money.reload()}
            tintColor={colors.accent}
          />
        }
        ListHeaderComponent={
          <View>
            <Text style={[styles.summary, { color: colors.secondary }]}>
              {transactions.length}
              {result.hasMore ? '+' : ''} transactions · {month}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filters}
              accessibilityRole="tablist"
            >
              {filters.map((item) => {
                const selected = filter === item.key;
                return (
                  <Pressable
                    key={item.key}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    onPress={() => setFilter(item.key)}
                    testID={`activity-filter-${item.key}`}
                    style={({ pressed }) => [
                      styles.filter,
                      {
                        backgroundColor: selected ? colors.text : colors.surface,
                        borderColor: selected ? colors.text : colors.separator,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterLabel,
                        { color: selected ? colors.background : colors.text },
                      ]}
                    >
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View
            style={[
              styles.sectionHeader,
              { backgroundColor: colors.background, borderBottomColor: colors.separator },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: colors.text }]}>{section.title}</Text>
            {section.total === null ? null : (
              <Text style={[styles.sectionTotal, { color: colors.secondary }]}>
                {formatMoney(section.total, 'ILS', true)}
              </Text>
            )}
          </View>
        )}
        renderItem={({ item, index, section }) => (
          <TransactionRow
            transaction={item}
            isLast={index === section.data.length - 1}
            onPress={() => router.push(`/(tabs)/activity/${item.id}`)}
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty} testID="activity-empty">
            {result.loading ? <ActivityIndicator color={colors.accent} /> : null}
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {result.loading
                ? 'Loading activity'
                : result.error
                  ? 'Couldn’t load activity'
                  : 'No matching transactions'}
            </Text>
            <Text style={[styles.emptyText, { color: colors.secondary }]}>
              {result.error ??
                (result.loading
                  ? 'Reading transactions from your Mac.'
                  : 'Clear search or choose another filter.')}
            </Text>
          </View>
        }
      />
    </>
  );
}

function TransactionRow({
  transaction,
  isLast,
  onPress,
}: {
  transaction: Transaction;
  isLast: boolean;
  onPress: () => void;
}) {
  const colors = useAppColors();
  const positive = transaction.amount > 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[
        transaction.merchant,
        formatMoney(transaction.amount, transaction.currencyCode, true),
        transaction.category,
        transaction.account,
        transaction.pending ? 'Pending' : '',
        transaction.needsReview ? 'Needs review' : '',
      ]
        .filter(Boolean)
        .join(', ')}
      accessibilityHint="Opens transaction details"
      onPress={onPress}
      testID={`transaction-${transaction.id}`}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? colors.surface : colors.background },
      ]}
    >
      <View
        style={[
          styles.merchantMark,
          { backgroundColor: markColor(transaction.category, colors.surface) },
        ]}
      >
        <Text style={styles.merchantInitial}>{merchantInitial(transaction.merchant)}</Text>
      </View>
      <View
        style={[
          styles.rowBody,
          !isLast && {
            borderBottomColor: colors.separator,
            borderBottomWidth: StyleSheet.hairlineWidth,
          },
        ]}
      >
        <View style={styles.rowTop}>
          <Text numberOfLines={1} style={[styles.merchant, { color: colors.text }]}>
            {transaction.merchant}
          </Text>
          <Text style={[styles.amount, { color: positive ? colors.accent : colors.text }]}>
            {formatMoney(transaction.amount, transaction.currencyCode, true)}
          </Text>
        </View>
        <View style={styles.rowBottom}>
          <Text numberOfLines={1} style={[styles.metadata, { color: colors.secondary }]}>
            {transaction.category} · {transaction.account}
          </Text>
          <View style={styles.flags}>
            {transaction.pending ? (
              <Flag label="Pending" color={colors.warning} background={colors.warningSoft} />
            ) : null}
            {transaction.needsReview ? (
              <Flag label="Review" color={colors.danger} background={colors.dangerSoft} />
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function Flag({ label, color, background }: { label: string; color: string; background: string }) {
  return (
    <View style={[styles.flag, { backgroundColor: background }]}>
      <Text style={[styles.flagText, { color }]}>{label}</Text>
    </View>
  );
}

function groupTransactions(transactions: Transaction[], currentDate: string, showTotals: boolean) {
  const grouped = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    const day = transaction.occurredAt.slice(0, 10);
    const group = grouped.get(day) ?? [];
    group.push(transaction);
    grouped.set(day, group);
  }

  return [...grouped.entries()].map(([day, data]) => ({
    title: dayLabel(day, currentDate),
    total: showTotals ? data.reduce((sum, transaction) => sum + transaction.amount, 0) : null,
    data,
  }));
}

function dayLabel(day: string, currentDate: string) {
  if (day === currentDate) return 'Today';
  const previous = new Date(`${currentDate}T12:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  if (day === previous.toISOString().slice(0, 10)) return 'Yesterday';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(
    new Date(`${day}T12:00:00Z`),
  );
}

function merchantInitial(merchant: string) {
  return merchant.trim().charAt(0).toLocaleUpperCase();
}

function markColor(category: string, fallback: string) {
  const colors: Record<string, string> = {
    Dining: '#D8E9DE',
    Income: '#D4E7E0',
    Health: '#E9DED7',
    Subscriptions: '#E1DDEA',
    Groceries: '#EFE1D2',
    Transfer: '#D9E4EB',
    Transport: '#D7E4EE',
    Housing: '#E6DFD2',
    Travel: '#DCE5DC',
  };
  return colors[category] ?? fallback;
}

const styles = StyleSheet.create({
  content: { paddingBottom: 40 },
  summary: { paddingHorizontal: 20, paddingTop: 8, fontSize: 13 },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 14 },
  filter: {
    minHeight: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterLabel: { fontSize: 13, fontWeight: '600' },
  sectionHeader: {
    minHeight: 40,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: { fontSize: 14, fontWeight: '700' },
  sectionTotal: { fontSize: 12, fontWeight: '500', fontVariant: ['tabular-nums'] },
  row: { minHeight: 70, flexDirection: 'row', paddingLeft: 16 },
  merchantMark: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 13,
  },
  merchantInitial: { color: '#263029', fontSize: 16, fontWeight: '700' },
  rowBody: {
    flex: 1,
    minWidth: 0,
    marginLeft: 12,
    paddingRight: 17,
    paddingVertical: 11,
    justifyContent: 'center',
  },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  merchant: { flex: 1, fontSize: 16, lineHeight: 21, fontWeight: '600', writingDirection: 'auto' },
  amount: {
    minWidth: 116,
    flexShrink: 0,
    textAlign: 'right',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  rowBottom: { minHeight: 22, flexDirection: 'row', alignItems: 'center', marginTop: 2, gap: 8 },
  metadata: { flex: 1, fontSize: 12.5, writingDirection: 'auto' },
  flags: { flexDirection: 'row', gap: 5 },
  flag: {
    height: 20,
    borderRadius: 6,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flagText: { fontSize: 10.5, fontWeight: '700' },
  empty: { alignItems: 'center', paddingHorizontal: 34, paddingTop: 72 },
  emptyTitle: { fontSize: 20, fontWeight: '700' },
  emptyText: { marginTop: 8, fontSize: 15, textAlign: 'center' },
});
