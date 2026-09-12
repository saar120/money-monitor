import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { ConnectionState } from '@/ConnectionState';
import { ActivityFiltersSheet, activityFilterCount } from '@/ActivityFiltersSheet';
import { useActivityTransactions, useMoneyData, type ActivityCriteria } from '@/MoneyData';
import { formatMoney } from '@/money';
import type { Transaction } from '@/fixtures';
import { categoryMarkColor, useAppColors } from '@/theme';

export default function ActivityScreen() {
  const colors = useAppColors();
  const [query, setQuery] = useState('');
  const [criteria, setCriteria] = useState<ActivityCriteria>({ inclusion: 'all' });
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [reviewOptions, setReviewOptions] = useState<{ categories: string[]; owners: string[] }>({
    categories: [],
    owners: [],
  });
  const [refreshing, setRefreshing] = useState(false);
  const searchBar = useRef<TextInput>(null);
  const money = useMoneyData();
  const result = useActivityTransactions(query, 'all', criteria, true);
  const transactions = result.transactions;
  const advancedFilters = activityFilterCount(criteria);
  const isUnfiltered = !query.trim() && advancedFilters === 0;
  const currentDate = money.home?.currentDate ?? new Date().toISOString().slice(0, 10);
  const categories = useMemo(
    () =>
      [
        ...new Set([...reviewOptions.categories, ...transactions.map((item) => item.category)]),
      ].sort(),
    [reviewOptions.categories, transactions],
  );
  const accounts = useMemo(
    () =>
      [...(money.home?.accounts ?? [])].sort((left, right) =>
        left.label.localeCompare(right.label),
      ),
    [money.home?.accounts],
  );
  const owners = useMemo(
    () => [...new Set([...reviewOptions.owners, ...transactions.map((item) => item.owner)])].sort(),
    [reviewOptions.owners, transactions],
  );

  useEffect(() => {
    void money
      .loadReviewOptions()
      .then(setReviewOptions)
      .catch(() => undefined);
  }, [money.loadReviewOptions]);
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
    <>
      <SectionList
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        stickySectionHeadersEnabled
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        sections={sections}
        keyExtractor={(item) => item.id}
        onEndReached={() => {
          if (!result.error) result.loadMore();
        }}
        onEndReachedThreshold={0.35}
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
            <View style={styles.filterBar}>
              <Text style={[styles.summary, { color: colors.secondary }]}>
                {transactions.length}
                {result.hasMore ? '+' : ''} transactions ·{' '}
                {criteria.startDate || criteria.endDate
                  ? `${criteria.startDate ?? 'first'}–${criteria.endDate ?? 'today'}`
                  : 'all dates'}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  searchBar.current?.blur();
                  setFiltersVisible(true);
                }}
                style={({ pressed }) => [
                  styles.filter,
                  {
                    backgroundColor: advancedFilters ? colors.accentSoft : colors.surfaceSoft,
                    borderColor: advancedFilters ? colors.accent : colors.separator,
                    opacity: pressed ? 0.76 : 1,
                  },
                ]}
                testID="activity-open-filters"
              >
                <View style={styles.filterWithIcon}>
                  <SymbolView
                    name="line.3.horizontal.decrease"
                    size={13}
                    tintColor={advancedFilters ? colors.accent : colors.secondary}
                  />
                  <Text
                    style={[
                      styles.filterLabel,
                      { color: advancedFilters ? colors.accent : colors.secondary },
                    ]}
                  >
                    Filters{advancedFilters ? ` · ${advancedFilters}` : ''}
                  </Text>
                </View>
              </Pressable>
            </View>
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
                  : isUnfiltered
                    ? 'No transactions yet'
                    : 'No matching transactions'}
            </Text>
            <Text style={[styles.emptyText, { color: colors.secondary }]}>
              {result.error ??
                (result.loading
                  ? 'Reading transactions from your Mac.'
                  : isUnfiltered
                    ? 'New activity will appear after your Mac syncs.'
                    : 'Clear search or choose another filter.')}
            </Text>
          </View>
        }
        ListFooterComponent={
          result.loadingMore ? (
            <ActivityIndicator color={colors.accent} style={styles.loadingMore} />
          ) : result.error && transactions.length && result.hasMore ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => result.loadMore()}
              style={({ pressed }) => [styles.retryMore, { opacity: pressed ? 0.62 : 1 }]}
            >
              <Text style={[styles.retryMoreText, { color: colors.accent }]}>Try loading more</Text>
            </Pressable>
          ) : null
        }
      />
      <ActivityFiltersSheet
        accounts={accounts}
        categories={categories}
        currentDate={currentDate}
        onApply={(value) => {
          setCriteria(value);
          setFiltersVisible(false);
        }}
        onClose={() => setFiltersVisible(false)}
        owners={owners}
        value={criteria}
        visible={filtersVisible}
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
    const day = transaction.effectiveDate || transaction.occurredAt.slice(0, 10);
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
  filterBar: {
    minHeight: 60,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  summary: { flex: 1, minWidth: 0, fontSize: 13 },
  refreshError: { paddingHorizontal: 20, paddingTop: 8, fontSize: 13, fontWeight: '600' },
  filter: {
    minHeight: 38,
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterLabel: { fontSize: 13, fontWeight: '600' },
  filterWithIcon: { flexDirection: 'row', alignItems: 'center', gap: 6 },
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
  loadingMore: { paddingVertical: 24 },
  retryMore: { minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  retryMoreText: { fontSize: 14, fontWeight: '600' },
});
