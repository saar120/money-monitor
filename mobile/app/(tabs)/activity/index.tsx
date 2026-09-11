import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { ConnectionState } from '@/ConnectionState';
import { useActivityTransactions, useMoneyData } from '@/MoneyData';
import { formatMoney } from '@/money';
import type { Transaction } from '@/fixtures';
import type { ActivityFilter } from '@/mobile-api';
import { categoryMarkColor, useAppColors } from '@/theme';

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
  const [refreshing, setRefreshing] = useState(false);
  const searchBar = useRef<TextInput>(null);
  const money = useMoneyData();
  const result = useActivityTransactions(query, filter);
  const transactions = result.transactions;
  const isEmptyMonth = !query.trim() && filter === 'all';
  const currentDate = money.home?.currentDate ?? new Date().toISOString().slice(0, 10);
  const month = money.home?.month ?? '';
  const refresh = async () => {
    setRefreshing(true);
    try {
      await money.reload();
    } finally {
      setRefreshing(false);
    }
  };

  const sections = useMemo(
    () => groupTransactions(transactions, currentDate),
    [currentDate, transactions],
  );

  if (money.status !== 'ready' || !money.home) return <ConnectionState />;

  return (
    <SectionList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      stickySectionHeadersEnabled
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      sections={sections}
      keyExtractor={(item) => item.id}
      testID={refreshing ? 'activity-screen-refreshing' : 'activity-screen'}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void refresh()}
          tintColor={colors.accent}
        />
      }
      ListHeaderComponent={
        <View>
          <View style={[styles.search, { backgroundColor: colors.surfaceSoft }]}>
            <SymbolView name="magnifyingglass" size={16} tintColor={colors.tertiary} />
            <TextInput
              ref={searchBar}
              accessibilityLabel="Merchant, category, or account"
              clearButtonMode="while-editing"
              onChangeText={setQuery}
              placeholder="Merchant, category, or account"
              placeholderTextColor={colors.tertiary}
              returnKeyType="search"
              style={[styles.searchInput, { color: colors.text }]}
              value={query}
            />
          </View>
          {money.home.reviewCount > 0 ? (
            <Pressable
              accessibilityHint="Opens the review queue"
              accessibilityRole="button"
              onPress={() => router.push('/review')}
              testID="activity-start-review"
              style={[styles.reviewBanner, { backgroundColor: colors.accentSoft }]}
            >
              <View style={styles.reviewBannerIcon}>
                <SymbolView name="checkmark.circle" size={20} tintColor={colors.accent} />
              </View>
              <View style={styles.reviewBannerText}>
                <Text style={[styles.reviewBannerTitle, { color: colors.text }]}>
                  {money.home.reviewCount} to review
                </Text>
                <Text style={[styles.reviewBannerDetail, { color: colors.secondary }]}>
                  Open your financial inbox
                </Text>
              </View>
              <SymbolView name="chevron.right" size={12} tintColor={colors.accent} />
            </Pressable>
          ) : null}
          {money.error ? (
            <Text style={[styles.refreshError, { color: colors.danger }]}>
              Couldn’t refresh · pull to retry
            </Text>
          ) : null}
          <Text style={[styles.summary, { color: colors.secondary }]}>
            {transactions.length}
            {result.hasMore ? '+' : ''} transactions ·{' '}
            {filter === 'review' ? 'financial inbox' : month}
          </Text>
          <ScrollView
            horizontal
            keyboardShouldPersistTaps="handled"
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
                  onPress={() => {
                    searchBar.current?.blur();
                    setFilter(item.key);
                  }}
                  testID={`activity-filter-${item.key}`}
                  style={({ pressed }) => [
                    styles.filter,
                    {
                      backgroundColor: selected ? colors.accent : colors.glass,
                      borderColor: selected ? colors.accent : colors.glassBorder,
                      shadowColor: selected ? colors.accent : colors.glassShadow,
                      opacity: pressed ? 0.76 : 1,
                      transform: [{ scale: pressed ? 0.94 : 1 }],
                    },
                  ]}
                >
                  <Text
                    style={[styles.filterLabel, { color: selected ? '#FFFFFF' : colors.secondary }]}
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
          <Text
            maxFontSizeMultiplier={1.5}
            numberOfLines={1}
            style={[styles.sectionTitle, { color: colors.text }]}
          >
            {section.title}
          </Text>
          {section.total === null ? null : (
            <Text
              adjustsFontSizeToFit
              allowFontScaling={false}
              minimumFontScale={0.8}
              numberOfLines={1}
              testID={`section-total-${section.id}`}
              style={[styles.sectionTotal, { color: colors.secondary }]}
            >
              {formatMoney(section.total.value, section.total.currencyCode, true)}
            </Text>
          )}
        </View>
      )}
      renderItem={({ item, index, section }) => (
        <TransactionRow
          transaction={item}
          isLast={index === section.data.length - 1}
          onPress={() => {
            searchBar.current?.blur();
            router.push(`/transaction/${item.id}`);
          }}
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
                : isEmptyMonth
                  ? 'No transactions yet'
                  : 'No matching transactions'}
          </Text>
          <Text style={[styles.emptyText, { color: colors.secondary }]}>
            {result.error ??
              (result.loading
                ? 'Reading transactions from your Mac.'
                : isEmptyMonth
                  ? 'New activity will appear after your Mac syncs.'
                  : 'Clear search or choose another filter.')}
          </Text>
        </View>
      }
    />
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
  const isDark = useColorScheme() === 'dark';
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
        { backgroundColor: pressed ? colors.surfaceSoft : colors.background },
      ]}
    >
      <View
        style={[
          styles.merchantMark,
          { backgroundColor: categoryMarkColor(transaction.category, isDark, colors.surfaceSoft) },
        ]}
      >
        <Text allowFontScaling={false} style={[styles.merchantInitial, { color: colors.text }]}>
          {merchantInitial(transaction.merchant)}
        </Text>
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
          <Text
            maxFontSizeMultiplier={1.5}
            numberOfLines={1}
            style={[styles.merchant, { color: colors.text }]}
          >
            {transaction.merchant}
          </Text>
          <Text
            adjustsFontSizeToFit
            allowFontScaling={false}
            minimumFontScale={0.75}
            numberOfLines={1}
            style={[styles.amount, { color: positive ? colors.positive : colors.text }]}
          >
            {formatMoney(transaction.amount, transaction.currencyCode, true)}
          </Text>
        </View>
        <View style={styles.rowBottom}>
          <Text
            maxFontSizeMultiplier={1.4}
            numberOfLines={1}
            style={[styles.metadata, { color: colors.secondary }]}
          >
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
      <Text maxFontSizeMultiplier={1.35} numberOfLines={1} style={[styles.flagText, { color }]}>
        {label}
      </Text>
    </View>
  );
}

function groupTransactions(transactions: Transaction[], currentDate: string) {
  const grouped = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    const day = transaction.occurredAt.slice(0, 10);
    const group = grouped.get(day) ?? [];
    group.push(transaction);
    grouped.set(day, group);
  }

  return [...grouped.entries()].map(([day, data]) => {
    const currencies = new Set(data.map((transaction) => transaction.currencyCode));
    return {
      id: day,
      title: dayLabel(day, currentDate),
      total:
        currencies.size === 1
          ? {
              value: data.reduce((sum, transaction) => sum + transaction.amount, 0),
              currencyCode: data[0]!.currencyCode,
            }
          : null,
      data,
    };
  });
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

const styles = StyleSheet.create({
  content: { paddingBottom: 36 },
  search: {
    height: 48,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 14,
    paddingHorizontal: 14,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  searchInput: { flex: 1, height: 48, fontSize: 16 },
  reviewBanner: {
    minHeight: 66,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 8,
    borderRadius: 16,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  reviewBannerIcon: { width: 28, alignItems: 'center' },
  reviewBannerText: { flex: 1 },
  reviewBannerTitle: { fontSize: 15, fontWeight: '700' },
  reviewBannerDetail: { marginTop: 2, fontSize: 12.5 },
  summary: { paddingHorizontal: 20, paddingTop: 8, fontSize: 13 },
  refreshError: { paddingHorizontal: 20, paddingTop: 8, fontSize: 13, fontWeight: '600' },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 14 },
  filter: {
    minHeight: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
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
  sectionTitle: { flex: 1, minWidth: 0, marginRight: 12, fontSize: 14, fontWeight: '700' },
  sectionTotal: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  row: { minHeight: 70, flexDirection: 'row', paddingLeft: 16 },
  merchantMark: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 13,
  },
  merchantInitial: { fontSize: 16, fontWeight: '700' },
  rowBody: {
    flex: 1,
    minWidth: 0,
    marginLeft: 12,
    paddingRight: 17,
    paddingVertical: 11,
    justifyContent: 'center',
  },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  merchant: { flex: 1, fontSize: 16, lineHeight: 21, fontWeight: '600', writingDirection: 'ltr' },
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
  metadata: { flex: 1, fontSize: 12.5, writingDirection: 'ltr' },
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
