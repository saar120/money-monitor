import { router } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ConnectionState } from '@/ConnectionState';
import { useMoneyData } from '@/MoneyData';
import { formatMoney, formatUnsignedMoney } from '@/money';
import { useAppColors, type AppColors } from '@/theme';

export default function HomeScreen() {
  const colors = useAppColors();
  const { error, home, status, reload } = useMoneyData();
  const [refreshing, setRefreshing] = useState(false);
  if (status !== 'ready' || !home) return <ConnectionState />;

  const paceDelta = home.spent - home.previousSpent;
  const primaryBudget = home.budgets[0] ?? null;
  const staleAccounts = home.freshness.filter((account) => account.state === 'stale');
  const attentionBudgets = home.budgets.filter((budget) => budget.status !== 'on_track');
  const topCategories = [...home.categories].sort((a, b) => b.spent - a.spent).slice(0, 4);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
      testID="home-screen"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void refresh()}
          tintColor={colors.accent}
        />
      }
    >
      <View style={styles.contextRow}>
        <Text
          maxFontSizeMultiplier={1.25}
          numberOfLines={1}
          style={[styles.period, { color: colors.secondary }]}
        >
          {home.month}
        </Text>
        <Text
          maxFontSizeMultiplier={1.25}
          numberOfLines={1}
          style={[
            styles.freshness,
            { color: error || staleAccounts.length ? colors.danger : colors.secondary },
          ]}
        >
          {error
            ? 'Couldn’t refresh · pull to retry'
            : staleAccounts.length
              ? `${staleAccounts.length} account${staleAccounts.length === 1 ? '' : 's'} need attention`
              : (home.freshness[0]?.detail ?? 'Updated on your Mac')}
        </Text>
      </View>

      <View style={styles.hero} testID="home-primary-money">
        <Text
          adjustsFontSizeToFit
          allowFontScaling={false}
          minimumFontScale={0.7}
          numberOfLines={1}
          style={[styles.heroValue, { color: colors.text }]}
        >
          {formatUnsignedMoney(home.spent, home.currencyCode)}
        </Text>
        <Text maxFontSizeMultiplier={1.3} style={[styles.heroLabel, { color: colors.text }]}>
          spent this month
        </Text>
        <Text
          maxFontSizeMultiplier={1.3}
          style={[styles.pace, { color: paceDelta <= 0 ? colors.accent : colors.warning }]}
          testID="spending-pace-summary"
        >
          {paceDelta === 0
            ? 'Right in line with last month'
            : `${formatUnsignedMoney(Math.abs(paceDelta), home.currencyCode)} ${paceDelta < 0 ? 'slower' : 'higher'} than last month’s pace`}
        </Text>
      </View>

      <View style={styles.cashflowRow}>
        <View style={styles.cashflowItem}>
          <Text
            maxFontSizeMultiplier={1.25}
            style={[styles.supportLabel, { color: colors.secondary }]}
          >
            Income
          </Text>
          <Text
            allowFontScaling={false}
            adjustsFontSizeToFit
            numberOfLines={1}
            style={[styles.supportValue, { color: colors.text }]}
          >
            {formatUnsignedMoney(home.income, home.currencyCode)}
          </Text>
        </View>
        <View style={[styles.cashflowDivider, { backgroundColor: colors.separator }]} />
        <View style={styles.cashflowItem}>
          <Text
            maxFontSizeMultiplier={1.25}
            numberOfLines={1}
            style={[styles.supportLabel, { color: colors.secondary }]}
          >
            Income spent
          </Text>
          <Text allowFontScaling={false} style={[styles.supportValue, { color: colors.text }]}>
            {home.spendingVsIncomePercent === null
              ? '—'
              : `${Math.round(home.spendingVsIncomePercent)}%`}
          </Text>
        </View>
      </View>

      {primaryBudget ? (
        <BudgetPace budget={primaryBudget} colors={colors} currencyCode={home.currencyCode} />
      ) : (
        <Pressable
          accessibilityHint="Opens spending insights"
          accessibilityRole="button"
          onPress={() => router.push('/(tabs)/explore')}
          style={styles.noBudget}
          testID="no-budget-state"
        >
          <Text style={[styles.noBudgetTitle, { color: colors.text }]}>No monthly budget</Text>
          <Text style={[styles.noBudgetText, { color: colors.secondary }]}>
            Spending pace is still compared with last month.
          </Text>
        </Pressable>
      )}

      {home.sinceLastVisit?.transactions ||
      home.reviewCount ||
      attentionBudgets.length ||
      staleAccounts.length ? (
        <View
          style={[styles.attention, { backgroundColor: colors.surface }]}
          testID="home-attention"
        >
          {home.sinceLastVisit?.transactions ? (
            <AttentionRow
              symbol="clock.arrow.circlepath"
              title="Since your last visit"
              detail={`${home.sinceLastVisit.transactions} new · ${formatUnsignedMoney(home.sinceLastVisit.spent, home.currencyCode)} spent`}
              colors={colors}
            />
          ) : null}
          {home.reviewCount ? (
            <AttentionRow
              symbol="checkmark.circle"
              title={`${home.reviewCount} transaction${home.reviewCount === 1 ? '' : 's'} to review`}
              detail="Clean up your financial inbox"
              colors={colors}
              onPress={() => router.push('/review')}
              testID="start-review"
            />
          ) : null}
          {attentionBudgets.length ? (
            <AttentionRow
              symbol="exclamationmark.triangle"
              title={`${attentionBudgets.length} budget${attentionBudgets.length === 1 ? '' : 's'} need attention`}
              detail={attentionBudgets[0]!.name}
              colors={colors}
              tone="warning"
              onPress={() => router.push('/(tabs)/explore')}
            />
          ) : null}
          {staleAccounts.length ? (
            <AttentionRow
              symbol="arrow.trianglehead.2.clockwise.rotate.90"
              title={`${staleAccounts.length} account${staleAccounts.length === 1 ? '' : 's'} need attention`}
              detail={
                staleAccounts.length === 1
                  ? staleAccounts[0]!.account
                  : `${staleAccounts[0]!.account} and ${staleAccounts.length - 1} more`
              }
              colors={colors}
              tone="danger"
              onPress={() => router.push('/accounts-attention')}
              testID="account-attention"
            />
          ) : null}
        </View>
      ) : (
        <View style={styles.caughtUp} testID="home-calm-state">
          <SymbolView name="checkmark.circle.fill" size={18} tintColor={colors.accent} />
          <Text style={[styles.caughtUpText, { color: colors.secondary }]}>
            Everything looks current
          </Text>
        </View>
      )}

      <SectionHeader
        title="Where it went"
        action="Explore"
        onPress={() => router.push('/(tabs)/explore')}
        colors={colors}
      />
      <View style={styles.categoryList} testID="category-spending">
        {topCategories.length ? (
          topCategories.map((category) => {
            const delta = category.spent - category.previous;
            const share = home.spent > 0 ? category.spent / home.spent : 0;
            return (
              <Pressable
                accessibilityHint={`Opens ${category.name} spending details`}
                accessibilityRole="button"
                key={category.name}
                onPress={() =>
                  router.push({
                    pathname: '/(tabs)/explore/category/[name]',
                    params: { name: category.name },
                  })
                }
                style={styles.categoryRow}
              >
                <View style={styles.categoryTop}>
                  <Text
                    maxFontSizeMultiplier={1.5}
                    numberOfLines={1}
                    style={[styles.categoryName, { color: colors.text }]}
                  >
                    {category.name}
                  </Text>
                  <Text
                    adjustsFontSizeToFit
                    allowFontScaling={false}
                    minimumFontScale={0.8}
                    numberOfLines={1}
                    style={[styles.categoryAmount, { color: colors.text }]}
                  >
                    {formatUnsignedMoney(category.spent, home.currencyCode)}
                  </Text>
                </View>
                <View style={styles.categoryBottom}>
                  <View style={[styles.shareTrack, { backgroundColor: colors.separator }]}>
                    <View
                      style={[
                        styles.shareFill,
                        { width: `${Math.min(share, 1) * 100}%`, backgroundColor: category.color },
                      ]}
                    />
                  </View>
                  <Text
                    allowFontScaling={false}
                    style={[
                      styles.categoryDelta,
                      { color: delta > 0 ? colors.warning : colors.secondary },
                    ]}
                  >
                    {delta === 0
                      ? 'No change'
                      : `${delta > 0 ? '+' : '−'}${formatUnsignedMoney(Math.abs(delta), home.currencyCode)} vs last month`}
                  </Text>
                </View>
              </Pressable>
            );
          })
        ) : (
          <Text style={[styles.emptyText, { color: colors.secondary }]}>
            No spending to show yet.
          </Text>
        )}
      </View>

      <Pressable
        accessibilityHint="Opens net worth details"
        accessibilityRole="button"
        onPress={() => router.push('/(tabs)/explore/net-worth')}
        style={[styles.netWorthRow, { borderTopColor: colors.separator }]}
        testID="net-worth-summary"
      >
        <View style={styles.netWorthCopy}>
          <Text style={[styles.netWorthLabel, { color: colors.secondary }]}>Net worth</Text>
          <Text
            adjustsFontSizeToFit
            allowFontScaling={false}
            minimumFontScale={0.8}
            numberOfLines={1}
            style={[styles.netWorthValue, { color: colors.text }]}
          >
            {formatUnsignedMoney(home.netWorth, home.currencyCode)}
          </Text>
        </View>
        <View style={styles.netWorthTrailing}>
          {home.netWorthChange !== null ? (
            <Text
              allowFontScaling={false}
              style={[
                styles.netWorthChange,
                { color: home.netWorthChange >= 0 ? colors.accent : colors.danger },
              ]}
            >
              {formatMoney(home.netWorthChange, home.currencyCode)} this month
            </Text>
          ) : null}
          <SymbolView name="chevron.right" size={13} tintColor={colors.tertiary} />
        </View>
      </Pressable>
    </ScrollView>
  );
}

function BudgetPace({
  budget,
  colors,
  currencyCode,
}: {
  budget: NonNullable<ReturnType<typeof useMoneyData>['home']>['budgets'][number];
  colors: AppColors;
  currencyCode: string;
}) {
  const over = budget.status === 'over_budget';
  return (
    <View
      style={styles.budgetPace}
      accessible
      accessibilityLabel={`${Math.round(budget.elapsedPercent)} percent of the month passed. ${Math.round(budget.usedPercent)} percent of ${budget.name} used.`}
      testID="budget-status"
    >
      <View style={styles.budgetHeading}>
        <Text
          maxFontSizeMultiplier={1.2}
          numberOfLines={1}
          style={[styles.budgetTitle, { color: colors.text }]}
        >
          {budget.name}
        </Text>
        <Text
          allowFontScaling={false}
          numberOfLines={1}
          style={[styles.budgetRemaining, { color: over ? colors.danger : colors.secondary }]}
        >
          {over
            ? `${formatUnsignedMoney(Math.abs(budget.remaining), currencyCode)} over`
            : `${formatUnsignedMoney(budget.remaining, currencyCode)} left`}
        </Text>
      </View>
      <PaceLine
        label="Month passed"
        value={budget.elapsedPercent}
        color={colors.secondary}
        colors={colors}
      />
      <PaceLine
        label="Budget used"
        value={budget.usedPercent}
        color={over ? colors.danger : colors.accent}
        colors={colors}
      />
      <Text
        maxFontSizeMultiplier={1.3}
        style={[styles.budgetInsight, { color: over ? colors.danger : colors.secondary }]}
      >
        {over
          ? 'This budget has been crossed'
          : `${Math.abs(Math.round(budget.usedPercent - budget.elapsedPercent))} points ${budget.usedPercent > budget.elapsedPercent ? 'ahead of' : 'behind'} the calendar`}
      </Text>
    </View>
  );
}

function PaceLine({
  label,
  value,
  color,
  colors,
}: {
  label: string;
  value: number;
  color: string;
  colors: AppColors;
}) {
  return (
    <View style={styles.paceLine}>
      <Text
        maxFontSizeMultiplier={1.2}
        numberOfLines={1}
        style={[styles.paceLineLabel, { color: colors.secondary }]}
      >
        {label}
      </Text>
      <View style={[styles.paceTrack, { backgroundColor: colors.separator }]}>
        <View
          style={[styles.paceFill, { width: `${Math.min(value, 100)}%`, backgroundColor: color }]}
        />
      </View>
      <Text allowFontScaling={false} style={[styles.pacePercent, { color: colors.text }]}>
        {Math.round(value)}%
      </Text>
    </View>
  );
}

function AttentionRow({
  symbol,
  title,
  detail,
  colors,
  tone,
  onPress,
  testID,
}: {
  symbol: SFSymbol;
  title: string;
  detail: string;
  colors: AppColors;
  tone?: 'warning' | 'danger';
  onPress?: () => void;
  testID?: string;
}) {
  const tint =
    tone === 'danger' ? colors.danger : tone === 'warning' ? colors.warning : colors.accent;
  const content = (
    <>
      <SymbolView name={symbol} size={18} tintColor={tint} />
      <View style={styles.attentionText}>
        <Text maxFontSizeMultiplier={1.6} style={[styles.attentionTitle, { color: colors.text }]}>
          {title}
        </Text>
        <Text
          maxFontSizeMultiplier={1.6}
          style={[styles.attentionDetail, { color: colors.secondary }]}
        >
          {detail}
        </Text>
      </View>
      {onPress ? <SymbolView name="chevron.right" size={12} tintColor={colors.tertiary} /> : null}
    </>
  );
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      testID={testID}
      style={styles.attentionRow}
    >
      {content}
    </Pressable>
  ) : (
    <View style={styles.attentionRow} testID={testID}>
      {content}
    </View>
  );
}

function SectionHeader({
  title,
  action,
  onPress,
  colors,
}: {
  title: string;
  action: string;
  onPress: () => void;
  colors: AppColors;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text
        maxFontSizeMultiplier={1.25}
        numberOfLines={1}
        style={[styles.sectionTitle, { color: colors.text }]}
      >
        {title}
      </Text>
      <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8}>
        <Text
          maxFontSizeMultiplier={1.25}
          numberOfLines={1}
          style={[styles.sectionAction, { color: colors.accent }]}
        >
          {action}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 48 },
  contextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 8,
  },
  period: { fontSize: 16, fontWeight: '600' },
  freshness: { maxWidth: '56%', fontSize: 13, textAlign: 'right' },
  hero: { paddingTop: 28 },
  heroValue: {
    fontSize: 48,
    lineHeight: 53,
    fontWeight: '700',
    letterSpacing: -2,
    fontVariant: ['tabular-nums'],
  },
  heroLabel: { marginTop: 1, fontSize: 23, lineHeight: 29, fontWeight: '600', letterSpacing: -0.4 },
  pace: { marginTop: 12, fontSize: 15, lineHeight: 21, fontWeight: '600' },
  cashflowRow: { flexDirection: 'row', alignItems: 'stretch', gap: 22, marginTop: 26 },
  cashflowItem: { flex: 1, minWidth: 0 },
  cashflowDivider: { width: StyleSheet.hairlineWidth },
  supportLabel: { fontSize: 13, fontWeight: '500' },
  supportValue: {
    marginTop: 3,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  budgetPace: { marginTop: 30 },
  budgetHeading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  budgetTitle: { flex: 1, minWidth: 0, fontSize: 17, fontWeight: '600' },
  budgetRemaining: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  paceLine: { minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 10 },
  paceLineLabel: { width: 104, fontSize: 13 },
  paceTrack: { flex: 1, height: 5, borderRadius: 3, overflow: 'hidden' },
  paceFill: { height: '100%', borderRadius: 3 },
  pacePercent: {
    width: 34,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  budgetInsight: { marginTop: 6, marginLeft: 114, fontSize: 12.5 },
  noBudget: { minHeight: 68, marginTop: 28, justifyContent: 'center' },
  noBudgetTitle: { fontSize: 16, fontWeight: '600' },
  noBudgetText: { marginTop: 4, fontSize: 13 },
  attention: { marginTop: 28, borderRadius: 16, paddingHorizontal: 14 },
  attentionRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12 },
  attentionText: { flex: 1, paddingVertical: 10 },
  attentionTitle: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  attentionDetail: { marginTop: 2, fontSize: 13, lineHeight: 18 },
  caughtUp: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 54, marginTop: 24 },
  caughtUpText: { fontSize: 14 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 36,
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 21, lineHeight: 27, fontWeight: '700', letterSpacing: -0.35 },
  sectionAction: { minHeight: 44, paddingTop: 12, fontSize: 14, fontWeight: '600' },
  categoryList: { gap: 18 },
  emptyText: { fontSize: 14, lineHeight: 20 },
  categoryRow: { minHeight: 52 },
  categoryTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  categoryName: { flex: 1, minWidth: 0, marginRight: 12, fontSize: 16, fontWeight: '600' },
  categoryAmount: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  categoryBottom: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 7 },
  shareTrack: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  shareFill: { height: '100%', borderRadius: 2 },
  categoryDelta: { width: 164, fontSize: 12, textAlign: 'right', fontVariant: ['tabular-nums'] },
  netWorthRow: {
    minHeight: 82,
    marginTop: 34,
    paddingTop: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  netWorthLabel: { fontSize: 13 },
  netWorthValue: {
    marginTop: 3,
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '700',
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  netWorthTrailing: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  netWorthCopy: { flex: 1, minWidth: 0, marginRight: 12 },
  netWorthChange: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
