import { MorphingArea, MorphingLine } from '@/MorphingChart';
import { DetailLink } from '@/DetailLink';
import { MonthSwipe, MotionRow, RollingAmount } from '@/Motion';
import { BudgetBar, budgetStatusColor } from '@/BudgetBar';
import { DirectionalChevron } from '@/DirectionalChevron';
import { categoryLabel } from '@/translations';
import { t } from '@/localization';
import { Text } from '@/LocalizedText';
import { Circle, DashPathEffect, Line as SkiaLine, vec } from '@shopify/react-native-skia';
import { CartesianChart, useChartPressState } from 'victory-native';
import { router, type Href } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { runOnJS, useAnimatedReaction, useDerivedValue } from 'react-native-reanimated';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { ConnectionState } from '@/ConnectionState';
import { MonthPicker } from '@/MonthPicker';
import { useMoneyData, useOverviewMonth } from '@/MoneyData';
import {
  formatMoney,
  formatSpendingChange,
  formatUnsignedMoney,
  overviewCashFlow,
  spendingTotal,
} from '@/money';
import { useAppColors, type AppColors } from '@/theme';

const trendKeys: ('current' | 'previous')[] = ['current', 'previous'];
const trendPadding = { top: 14, bottom: 8, left: 2, right: 2 };
const trendPress = { pan: { activateAfterLongPress: 80 } };

export default function HomeScreen() {
  const colors = useAppColors();
  const money = useMoneyData();
  const selected = useOverviewMonth();
  const { error, status, reload } = money;
  const home = selected.overview;
  const [refreshing, setRefreshing] = useState(false);
  if (status !== 'ready' || !home) return <ConnectionState />;

  const primaryBudget = home.budgets[0] ?? null;
  const staleAccounts = home.freshness.filter((account) => account.state === 'stale');
  const attentionBudgets = home.budgets.filter((budget) => budget.status !== 'on_track');
  const topCategories = [...home.categories]
    .filter((category) => category.spent > 0)
    .sort((a, b) => b.spent - a.spent)
    .slice(0, 4);
  const cashFlow = overviewCashFlow(home.income, home.spent);
  const openBudgets = () =>
    router.push({ pathname: '/budgets', params: { month: home.monthKey } });
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
      <View style={styles.topBar}>
        <MonthPicker
          month={home.monthKey}
          months={selected.months}
          onSelect={selected.selectMonth}
          testID="home-month-picker"
        />
        <Pressable
          accessibilityLabel={t('settings')}
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => router.push('/settings')}
          style={({ pressed }) => [
            styles.settingsButton,
            { backgroundColor: colors.surface, opacity: pressed ? 0.6 : 1 },
          ]}
          testID="open-settings"
        >
          <SymbolView name="gearshape" size={20} tintColor={colors.secondary} />
        </Pressable>
      </View>

      <MonthSwipe
        style={styles.hero}
        testID="home-primary-money"
        month={home.monthKey}
        months={selected.months}
        onSelect={(month) => {
          if (!selected.loading) selected.selectMonth(month);
        }}
      >
        <View style={styles.heroHeader}>
          <Text maxFontSizeMultiplier={1.3} style={[styles.heroLabel, { color: colors.text }]}>
            {t('totalSpending')}
          </Text>
          {error || !staleAccounts.length ? (
            <Text
              maxFontSizeMultiplier={1.25}
              numberOfLines={1}
              style={[styles.freshness, { color: error ? colors.danger : colors.secondary }]}
            >
              {error
                ? t('couldnTRefreshPullToRetry')
                : (home.freshness[0]?.detail ?? t('updatedOnYourMac'))}
            </Text>
          ) : null}
        </View>
        <RollingAmount
          style={[styles.heroValue, { color: colors.text }]}
          value={formatUnsignedMoney(home.spent, home.currencyCode)}
        />
        <Text style={[styles.heroComparison, { color: colors.secondary }]}>
          {home.spent === home.previousSpent
            ? t('inLineWithLastMonth')
            : t(home.spent < home.previousSpent ? 'slowerPace' : 'higherPace', {
                amount: formatUnsignedMoney(
                  Math.abs(home.spent - home.previousSpent),
                  home.currencyCode,
                ),
              })}
        </Text>
      </MonthSwipe>

      {home.reviewCount ||
      attentionBudgets.length ||
      staleAccounts.length ||
      home.sinceLastVisit?.transactions ? (
        <View
          style={[styles.attention, { backgroundColor: colors.surface }]}
          testID="home-attention"
        >
          {home.reviewCount ? (
            <AttentionRow
              symbol="checkmark.circle"
              title={t('transactionsToReview', { count: home.reviewCount })}
              colors={colors}
              onPress={() => router.push('/review')}
              testID="start-review"
            />
          ) : null}
          {attentionBudgets.length ? (
            <AttentionRow
              symbol="exclamationmark.triangle"
              title={t('budgetsNeedAttention', { count: attentionBudgets.length })}
              detail={attentionBudgets[0]!.name}
              colors={colors}
              tone="warning"
              onPress={openBudgets}
              testID="budget-attention"
            />
          ) : null}
          {staleAccounts.length ? (
            <AttentionRow
              symbol="arrow.trianglehead.2.clockwise.rotate.90"
              title={t('accountsNeedAttention', { count: staleAccounts.length })}
              detail={
                staleAccounts.length === 1
                  ? staleAccounts[0]!.account
                  : t('nameAndMore', {
                      name: staleAccounts[0]!.account,
                      count: staleAccounts.length - 1,
                    })
              }
              colors={colors}
              tone="danger"
              href="/accounts-attention"
              testID="account-attention"
            />
          ) : null}
          {home.sinceLastVisit?.transactions ? (
            <AttentionRow
              symbol="clock.arrow.circlepath"
              title={t('sinceYourLastVisit')}
              detail={t('newSpent', {
                count: home.sinceLastVisit.transactions,
                amount: formatUnsignedMoney(home.sinceLastVisit.spent, home.currencyCode),
              })}
              colors={colors}
              onPress={() => router.navigate('/(tabs)/activity')}
              testID="since-last-visit"
            />
          ) : null}
        </View>
      ) : error ? null : (
        <View style={styles.caughtUp} testID="home-calm-state">
          <SymbolView name="checkmark.circle.fill" size={18} tintColor={colors.positive} />
          <Text style={[styles.caughtUpText, { color: colors.secondary }]}>
            {t('everythingLooksCurrent')}
          </Text>
        </View>
      )}

      <SpendingTrendCard
        colors={colors}
        currencyCode={home.currencyCode}
        currentDate={home.currentDate}
        isLatestMonth={home.monthKey === [...selected.months].sort().at(-1)}
        spent={home.spent}
        trend={home.trend}
      />

      <View style={[styles.cashflowRow, { borderBottomColor: colors.separator }]}>
        <View style={styles.cashflowItem}>
          <Text
            maxFontSizeMultiplier={1.25}
            style={[styles.supportLabel, { color: colors.secondary }]}
          >
            {t('postedIncome')}
          </Text>
          <Text
            adjustsFontSizeToFit
            maxFontSizeMultiplier={1.5}
            numberOfLines={1}
            style={[styles.supportValue, { color: colors.text }]}
          >
            {formatUnsignedMoney(home.income, home.currencyCode)}
          </Text>
        </View>
        <View style={styles.cashflowItem}>
          <Text
            maxFontSizeMultiplier={1.25}
            numberOfLines={1}
            style={[styles.supportLabel, { color: colors.secondary }]}
          >
            {t('netCashFlow')}
          </Text>
          <Text
            adjustsFontSizeToFit
            maxFontSizeMultiplier={1.5}
            numberOfLines={1}
            style={[
              styles.supportValue,
              { color: cashFlow >= 0 ? colors.positive : colors.danger },
            ]}
          >
            {formatMoney(cashFlow, home.currencyCode)}
          </Text>
        </View>
      </View>

      {primaryBudget ? (
        <BudgetPace
          budget={primaryBudget}
          colors={colors}
          currencyCode={home.currencyCode}
          onPress={openBudgets}
        />
      ) : (
        <Pressable
          accessibilityHint={t('opensSpendingInsights')}
          accessibilityRole="button"
          onPress={() => router.push('/(tabs)/explore')}
          style={styles.noBudget}
          testID="no-budget-state"
        >
          <Text style={[styles.noBudgetTitle, { color: colors.text }]}>{t('noMonthlyBudget')}</Text>
        </Pressable>
      )}

      <View style={styles.categorySectionHeader}>
        <Text
          maxFontSizeMultiplier={1.4}
          style={[styles.categorySectionTitle, { color: colors.text }]}
        >
          {t('whereItWent')}
        </Text>
        <Pressable accessibilityRole="button" onPress={() => router.push('/(tabs)/explore')}>
          <Text
            maxFontSizeMultiplier={1.4}
            style={[styles.categorySectionAction, { color: colors.accent }]}
          >
            {t('explore')}
          </Text>
        </Pressable>
      </View>
      <View style={styles.categoryList} testID="category-spending">
        {topCategories.length ? (
          topCategories.map((category) => {
            const delta = category.spent - category.previous;
            const total = spendingTotal(category.spent, home.currencyCode);
            return (
              <MotionRow key={category.name}>
                <DetailLink
                  accessibilityLabel={`${categoryLabel(category.name)}, ${total.amount} ${total.label}, ${formatSpendingChange(delta, home.currencyCode)}`}
                  accessibilityHint={t('opensSpendingDetails', {
                    name: categoryLabel(category.name),
                  })}
                  accessibilityRole="button"
                  href={{
                    pathname: '/category/[name]',
                    params: { name: category.name, month: home.monthKey },
                  }}
                  style={({ pressed }) => [styles.categoryRow, { opacity: pressed ? 0.62 : 1 }]}
                  testID={`home-category-${category.name}`}
                >
                  <View style={styles.categoryTop}>
                    <Text numberOfLines={1} style={[styles.categoryName, { color: colors.text }]}>
                      {categoryLabel(category.name)}
                    </Text>
                    <Text
                      maxFontSizeMultiplier={1.5}
                      numberOfLines={1}
                      style={[styles.categoryAmount, { color: colors.text }]}
                    >
                      {total.amount}
                    </Text>
                  </View>
                  <View style={styles.categoryBottom}>
                    <View style={[styles.categoryTrack, { backgroundColor: colors.separator }]}>
                      <View
                        style={[
                          styles.categoryFill,
                          {
                            backgroundColor: category.color,
                            width: `${Math.min(1, category.spent / Math.max(1, home.spent)) * 100}%`,
                          },
                        ]}
                      />
                    </View>
                    <Text
                      maxFontSizeMultiplier={1.4}
                      numberOfLines={1}
                      style={[
                        styles.categoryDelta,
                        {
                          color:
                            delta > 0
                              ? colors.warning
                              : delta < 0
                                ? colors.positive
                                : colors.secondary,
                        },
                      ]}
                    >
                      {delta === 0 ? t('noChange') : formatMoney(delta, home.currencyCode)}
                    </Text>
                  </View>
                </DetailLink>
              </MotionRow>
            );
          })
        ) : (
          <Text style={[styles.emptyText, { color: colors.secondary }]}>
            {t('noSpendingToShowYet')}
          </Text>
        )}
      </View>

      <Pressable
        accessibilityHint={t('opensNetWorthDetails')}
        accessibilityRole="button"
        onPress={() => router.push('/net-worth')}
        style={[styles.netWorthRow, { borderTopColor: colors.separator }]}
        testID="net-worth-summary"
      >
        <View style={styles.netWorthCopy}>
          <Text style={[styles.netWorthLabel, { color: colors.secondary }]}>{t('netWorth')}</Text>
          <Text
            adjustsFontSizeToFit
            maxFontSizeMultiplier={1.4}
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
              maxFontSizeMultiplier={1.3}
              style={[
                styles.netWorthChange,
                { color: home.netWorthChange >= 0 ? colors.positive : colors.danger },
              ]}
            >
              {formatMoney(home.netWorthChange, home.currencyCode)} {t('thisMonth')}
            </Text>
          ) : null}
          <DirectionalChevron direction="forward" size={13} tintColor={colors.tertiary} />
        </View>
      </Pressable>
    </ScrollView>
  );
}

function SpendingTrendCard({
  colors,
  currencyCode,
  currentDate,
  isLatestMonth,
  spent,
  trend,
}: {
  colors: AppColors;
  currencyCode: string;
  currentDate: string;
  isLatestMonth: boolean;
  spent: number;
  trend: Array<{ day: number; current: number; previous: number }>;
}) {
  const day = Number(currentDate.slice(8, 10));
  const max = Math.max(1, ...trend.flatMap((point) => [point.current, point.previous]));
  const domain = useMemo(() => ({ y: [0, max * 1.08] as [number, number] }), [max]);
  const { state, isActive } = useChartPressState({
    x: trend.at(-1)?.day ?? day,
    y: { current: trend.at(-1)?.current ?? spent, previous: trend.at(-1)?.previous ?? 0 },
  });
  const guideTop = useDerivedValue(() => vec(state.x.position.value, 10));
  const guideBottom = useDerivedValue(() => vec(state.x.position.value, 142));
  const [selection, setSelection] = useState<{ trend: typeof trend; index: number } | null>(null);
  const selectedIndex =
    selection?.trend === trend ? selection.index : Math.max(0, trend.length - 1);
  const selectIndex = (index: number) => setSelection({ trend, index });
  useAnimatedReaction(
    () => (state.isActive.value ? state.matchedIndex.value : -1),
    (index, previous) => {
      if (index >= 0 && index !== previous) runOnJS(selectIndex)(index);
    },
  );

  const selected = trend[selectedIndex] ?? { day, current: spent, previous: spent };
  const delta = selected.current - selected.previous;
  if (!trend.length) {
    return (
      <View
        style={[
          styles.spendingHero,
          styles.noChart,
          { backgroundColor: colors.surface, borderColor: colors.separator },
        ]}
        testID="home-spending-chart"
      >
        <Text style={[styles.noChartText, { color: colors.secondary }]}>
          {t('noPostedSpendingYet')}
        </Text>
      </View>
    );
  }
  return (
    <View
      style={[
        styles.spendingHero,
        { backgroundColor: colors.surface, borderColor: colors.separator },
      ]}
      testID="home-spending-chart"
    >
      <View style={styles.chartHeader}>
        {isActive ? (
          <>
            <Text style={[styles.chartMetricStrong, { color: colors.text }]}>
              {t('dayAmount', {
                day: selected.day,
                amount: formatUnsignedMoney(selected.current, currencyCode),
              })}
            </Text>
            <Text style={[styles.chartMetric, { color: colors.secondary }]}>
              {delta === 0
                ? t('inLineWithLastMonth')
                : t(delta < 0 ? 'slowerPace' : 'higherPace', {
                    amount: formatUnsignedMoney(Math.abs(delta), currencyCode),
                  })}
            </Text>
          </>
        ) : (
          <View style={styles.chartLegend}>
            <View style={styles.chartLegendItem}>
              <View style={[styles.legendLine, { backgroundColor: colors.chart }]} />
              <Text style={[styles.chartSourceText, { color: colors.secondary }]}>
                {t('thisMonth2')}
              </Text>
            </View>
            <View style={styles.chartLegendItem}>
              <View
                style={[
                  styles.legendLine,
                  { borderColor: colors.chartComparison, borderTopWidth: 2, borderStyle: 'dashed' },
                ]}
              />
              <Text style={[styles.chartSourceText, { color: colors.secondary }]}>
                {t('previousMonth')}
              </Text>
            </View>
          </View>
        )}
      </View>
      <View
        style={styles.chartBody}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={t('spendingThroughDayNumber', { count: day })}
        accessibilityValue={{
          min: 1,
          max: trend.length,
          now: selectedIndex + 1,
          text: t('dayAmount', {
            day: selected.day,
            amount: formatUnsignedMoney(selected.current, currencyCode),
          }),
        }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) =>
          selectIndex(
            Math.max(
              0,
              Math.min(
                trend.length - 1,
                selectedIndex + (event.nativeEvent.actionName === 'increment' ? 1 : -1),
              ),
            ),
          )
        }
      >
        <CartesianChart
          chartPressConfig={trendPress}
          chartPressState={state}
          data={trend}
          domain={domain}
          padding={trendPadding}
          xKey="day"
          yKeys={trendKeys}
          yAxis={[
            {
              yKeys: trendKeys,
              lineColor: colors.separator,
              lineWidth: StyleSheet.hairlineWidth,
              tickCount: 4,
            },
          ]}
        >
          {({ points, chartBounds }) => (
            <>
              <MorphingArea
                color={colors.chart}
                curveType="linear"
                opacity={0.08}
                points={points.current}
                y0={chartBounds.bottom}
              />
              <MorphingLine
                color={colors.chartComparison}
                curveType="linear"
                points={points.previous}
                strokeWidth={2}
              >
                <DashPathEffect intervals={[5, 5]} />
              </MorphingLine>
              <MorphingLine
                color={colors.chart}
                curveType="linear"
                points={points.current}
                strokeWidth={2.8}
              />
              {isActive ? (
                <>
                  <SkiaLine
                    p1={guideTop}
                    p2={guideBottom}
                    color={colors.secondary}
                    strokeWidth={1}
                  />
                  <Circle
                    color={colors.accentSoft}
                    cx={state.x.position}
                    cy={state.y.current.position}
                    r={12}
                  />
                  <Circle
                    color={colors.chart}
                    cx={state.x.position}
                    cy={state.y.current.position}
                    r={5}
                  />
                </>
              ) : null}
            </>
          )}
        </CartesianChart>
      </View>
      <View style={styles.chartAxis}>
        <Text style={[styles.chartAxisText, { color: colors.secondary }]}>{t('day1')}</Text>
        <Text style={[styles.chartAxisText, { color: colors.secondary }]}>{t('postedOnly')}</Text>
        <Text style={[styles.chartAxisText, { color: colors.secondary }]}>
          {isLatestMonth ? t('todayDay', { count: day }) : t('dayNumber', { count: day })}
        </Text>
      </View>
    </View>
  );
}

function BudgetPace({
  budget,
  colors,
  currencyCode,
  onPress,
}: {
  budget: NonNullable<ReturnType<typeof useMoneyData>['home']>['budgets'][number];
  colors: AppColors;
  currencyCode: string;
  onPress: () => void;
}) {
  const over = budget.status === 'over_budget';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('budgetAccessibility', {
        elapsed: Math.round(budget.elapsedPercent),
        used: Math.round(budget.usedPercent),
        name: budget.name,
      })}
      onPress={onPress}
      style={({ pressed }) => [styles.budgetPace, { opacity: pressed ? 0.62 : 1 }]}
      testID="budget-status"
    >
      <View style={styles.budgetHeading}>
        <Text
          maxFontSizeMultiplier={1.3}
          numberOfLines={1}
          style={[styles.budgetTitle, { color: colors.text }]}
        >
          {budget.name}
        </Text>
        <Text
          maxFontSizeMultiplier={1.3}
          numberOfLines={1}
          style={[styles.budgetRemaining, { color: over ? colors.danger : colors.secondary }]}
        >
          {over
            ? t('amountOver', {
                amount: formatUnsignedMoney(Math.abs(budget.remaining), currencyCode),
              })
            : t('amountLeft', { amount: formatUnsignedMoney(budget.remaining, currencyCode) })}
        </Text>
        <DirectionalChevron direction="forward" size={12} tintColor={colors.tertiary} />
      </View>
      <BudgetBar
        color={budgetStatusColor(budget.status, colors)}
        elapsedPercent={budget.elapsedPercent}
        usedPercent={budget.usedPercent}
      />
      <View style={styles.budgetCaption}>
        <Text maxFontSizeMultiplier={1.3} style={[styles.budgetCaptionText, { color: colors.secondary }]}>
          {t('percentUsed', { count: Math.round(budget.usedPercent) })}
        </Text>
        <Text maxFontSizeMultiplier={1.3} style={[styles.budgetCaptionText, { color: colors.secondary }]}>
          {t('monthElapsed', { count: Math.round(budget.elapsedPercent) })}
        </Text>
      </View>
    </Pressable>
  );
}

function AttentionRow({
  symbol,
  title,
  detail,
  colors,
  tone,
  onPress,
  href,
  testID,
}: {
  symbol: SFSymbol;
  title: string;
  detail?: string;
  colors: AppColors;
  tone?: 'warning' | 'danger';
  onPress?: () => void;
  href?: Href;
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
        {detail ? (
          <Text
            maxFontSizeMultiplier={1.6}
            style={[styles.attentionDetail, { color: colors.secondary }]}
          >
            {detail}
          </Text>
        ) : null}
      </View>
      {onPress || href ? (
        <DirectionalChevron direction="forward" size={12} tintColor={colors.tertiary} />
      ) : null}
    </>
  );
  if (href)
    return (
      <DetailLink
        accessibilityLabel={detail ? `${title}, ${detail}` : title}
        href={href}
        accessibilityRole="button"
        testID={testID}
        style={({ pressed }) => [styles.attentionRow, { opacity: pressed ? 0.62 : 1 }]}
      >
        {content}
      </DetailLink>
    );
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.attentionRow, { opacity: pressed ? 0.62 : 1 }]}
    >
      {content}
    </Pressable>
  ) : (
    <View style={styles.attentionRow} testID={testID}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 36 },
  topBar: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  settingsButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  freshness: { flexShrink: 1, fontSize: 12.5 },
  hero: { paddingTop: 20, paddingBottom: 20 },
  heroComparison: { marginTop: 8, fontSize: 14, lineHeight: 20 },
  heroHeader: {
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  heroValue: {
    fontSize: 52,
    lineHeight: 60,
    fontWeight: '600',
    letterSpacing: -2,
    fontVariant: ['tabular-nums'],
  },
  heroLabel: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  spendingHero: {
    marginTop: 20,
    overflow: 'hidden',
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  chartHeader: { minHeight: 38, justifyContent: 'center' },
  chartSourceText: { fontSize: 12, lineHeight: 17 },
  chartLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
  chartLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendLine: { width: 18, height: 2 },
  chartBody: { height: 152, marginTop: 4, direction: 'ltr' },
  noChart: { minHeight: 96, alignItems: 'center', justifyContent: 'center' },
  noChartText: { fontSize: 13 },
  chartAxis: {
    direction: 'ltr',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 3,
  },
  chartAxisText: { fontSize: 11 },
  chartMetric: { fontSize: 12, lineHeight: 17 },
  chartMetricStrong: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  categorySectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 36,
    marginBottom: 12,
  },
  categorySectionTitle: { flexShrink: 1, fontSize: 21, lineHeight: 27, fontWeight: '700', letterSpacing: -0.35 },
  categorySectionAction: { minHeight: 44, paddingTop: 12, fontSize: 14, fontWeight: '600' },
  categoryList: { gap: 10 },
  categoryRow: { minHeight: 64, paddingVertical: 6 },
  categoryTop: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  categoryName: { flex: 1, minWidth: 0, fontSize: 16, fontWeight: '600' },
  categoryAmount: { flexShrink: 0, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  categoryBottom: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 7 },
  categoryTrack: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  categoryFill: { height: '100%', borderRadius: 2 },
  categoryDelta: {
    flexShrink: 0,
    fontSize: 12.5,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  cashflowRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 24,
    marginTop: 4,
    paddingVertical: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cashflowItem: { flex: 1, minWidth: 0 },
  supportLabel: { fontSize: 13, fontWeight: '500' },
  supportValue: {
    marginTop: 3,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  budgetPace: { marginTop: 22 },
  budgetHeading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    marginBottom: 12,
  },
  budgetTitle: { flex: 1, minWidth: 0, fontSize: 17, fontWeight: '600' },
  budgetRemaining: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  budgetCaption: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 12, marginTop: 8 },
  budgetCaptionText: { fontSize: 12.5, fontVariant: ['tabular-nums'] },
  noBudget: { minHeight: 68, marginTop: 28, justifyContent: 'center' },
  noBudgetTitle: { fontSize: 16, fontWeight: '600' },
  attention: { borderRadius: 20, paddingHorizontal: 14 },
  attentionRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12 },
  attentionText: { flex: 1, minWidth: 0, paddingVertical: 10 },
  attentionTitle: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  attentionDetail: { marginTop: 2, fontSize: 13, lineHeight: 18 },
  caughtUp: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 44 },
  caughtUpText: { fontSize: 14 },
  emptyText: { fontSize: 14, lineHeight: 20 },
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
  netWorthCopy: { flex: 1, minWidth: 0, marginEnd: 12 },
  netWorthChange: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
