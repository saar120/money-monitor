import { Circle } from '@shopify/react-native-skia';
import { Area, CartesianChart, Line, Pie, PolarChart, useChartPressState } from 'victory-native';
import { router } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useAnimatedReaction } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ConnectionState } from '@/ConnectionState';
import { MonthPicker } from '@/MonthPicker';
import { useMoneyData, useOverviewMonth } from '@/MoneyData';
import { formatMoney, formatUnsignedMoney, overviewCashFlow } from '@/money';
import type { HomeData } from '@/fixtures';
import { useAppColors, type AppColors } from '@/theme';

export default function HomeScreen() {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const money = useMoneyData();
  const selected = useOverviewMonth();
  const { error, status, reload } = money;
  const home = selected.overview;
  const [refreshing, setRefreshing] = useState(false);
  if (status !== 'ready' || !home) return <ConnectionState />;

  const primaryBudget = home.budgets[0] ?? null;
  const staleAccounts = home.freshness.filter((account) => account.state === 'stale');
  const attentionBudgets = home.budgets.filter((budget) => budget.status !== 'on_track');
  const cashFlow = overviewCashFlow(home.income, home.spent);
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
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 10 }]}
      contentInsetAdjustmentBehavior="never"
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
        <View style={styles.monthContext}>
          <Text maxFontSizeMultiplier={1.25} style={[styles.greeting, { color: colors.secondary }]}>
            Good morning
          </Text>
          <MonthPicker
            month={selected.month}
            months={selected.months}
            onSelect={selected.selectMonth}
            testID="home-month-picker"
          />
        </View>
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
      </View>

      <ChartCarousel
        categories={home.categories}
        colors={colors}
        currencyCode={home.currencyCode}
        currentDate={home.currentDate}
        month={home.monthKey}
        spent={home.spent}
        trend={home.trend}
      />

      <View style={[styles.cashflowRow, { borderBottomColor: colors.separator }]}>
        <View style={styles.cashflowItem}>
          <Text
            maxFontSizeMultiplier={1.25}
            style={[styles.supportLabel, { color: colors.secondary }]}
          >
            Posted income
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
        <View style={styles.cashflowItem}>
          <Text
            maxFontSizeMultiplier={1.25}
            numberOfLines={1}
            style={[styles.supportLabel, { color: colors.secondary }]}
          >
            Net cash flow
          </Text>
          <Text
            allowFontScaling={false}
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
          <SymbolView name="checkmark.circle.fill" size={18} tintColor={colors.positive} />
          <Text style={[styles.caughtUpText, { color: colors.secondary }]}>
            Everything looks current
          </Text>
        </View>
      )}

      <Pressable
        accessibilityHint="Opens net worth details"
        accessibilityRole="button"
        onPress={() => router.push('/net-worth')}
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
                { color: home.netWorthChange >= 0 ? colors.positive : colors.danger },
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

function ChartCarousel({
  categories,
  colors,
  currencyCode,
  currentDate,
  month,
  spent,
  trend,
}: {
  categories: HomeData['categories'];
  colors: AppColors;
  currencyCode: string;
  currentDate: string;
  month: string;
  spent: number;
  trend: Array<{ day: number; current: number; previous: number }>;
}) {
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  return (
    <View
      onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))}
      testID="home-chart-carousel"
    >
      {width ? (
        <ScrollView
          horizontal
          bounces={false}
          decelerationRate="fast"
          onMomentumScrollEnd={(event) =>
            setPage(Math.round(event.nativeEvent.contentOffset.x / width))
          }
          pagingEnabled
          showsHorizontalScrollIndicator={false}
        >
          <View style={{ width }}>
            <SpendingTrendCard
              colors={colors}
              currencyCode={currencyCode}
              currentDate={currentDate}
              spent={spent}
              trend={trend}
            />
          </View>
          <View style={{ width }}>
            <CategoryDonutCard
              categories={categories}
              colors={colors}
              currencyCode={currencyCode}
              month={month}
              spent={spent}
            />
          </View>
        </ScrollView>
      ) : null}
      <View style={styles.carouselFooter}>
        <Text style={[styles.carouselLabel, { color: colors.secondary }]}>
          {page === 0 ? 'Spending pace · hold and slide' : 'Categories · tap to drill down'}
        </Text>
        <View style={styles.pageDots}>
          {[0, 1].map((index) => (
            <View
              key={index}
              style={[
                styles.pageDot,
                { backgroundColor: index === page ? colors.accent : colors.separator },
              ]}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

function SpendingTrendCard({
  colors,
  currencyCode,
  currentDate,
  spent,
  trend,
}: {
  colors: AppColors;
  currencyCode: string;
  currentDate: string;
  spent: number;
  trend: Array<{ day: number; current: number; previous: number }>;
}) {
  const day = Number(currentDate.slice(8, 10));
  const max = Math.max(1, ...trend.flatMap((point) => [point.current, point.previous]));
  const { state, isActive } = useChartPressState({
    x: trend.at(-1)?.day ?? day,
    y: { current: trend.at(-1)?.current ?? spent, previous: trend.at(-1)?.previous ?? 0 },
  });
  const [selectedIndex, setSelectedIndex] = useState(Math.max(0, trend.length - 1));

  useEffect(() => setSelectedIndex(Math.max(0, trend.length - 1)), [trend]);
  useAnimatedReaction(
    () => state.matchedIndex.value,
    (index, previous) => {
      if (index >= 0 && index !== previous) runOnJS(setSelectedIndex)(index);
    },
  );

  const selected = trend[selectedIndex] ?? { day, current: spent, previous: spent };
  const delta = selected.current - selected.previous;
  return (
    <View
      style={[styles.spendingHero, { backgroundColor: colors.chart, shadowColor: colors.chart }]}
      testID="home-spending-chart"
    >
      <View style={styles.chartHeading}>
        <Text style={styles.chartTitle}>Spending through day {day}</Text>
        <View style={styles.chartSource}>
          <SymbolView name="checkmark.circle" size={11} tintColor="rgba(255,255,255,0.8)" />
          <Text style={styles.chartSourceText}>Posted only</Text>
        </View>
      </View>
      <View style={styles.chartBody}>
        <View pointerEvents="none" style={styles.chartGrid}>
          <View style={styles.chartGridLine} />
          <View style={styles.chartGridLine} />
          <View style={styles.chartGridLine} />
        </View>
        {trend.length ? (
          <CartesianChart
            chartPressConfig={{ pan: { activateAfterLongPress: 80 } }}
            chartPressState={state}
            data={trend}
            domain={{ y: [0, max * 1.08] }}
            padding={{ top: 14, bottom: 8, left: 2, right: 2 }}
            xKey="day"
            yKeys={['current', 'previous']}
          >
            {({ points, chartBounds }) => (
              <>
                <Area
                  color="#86B9FF"
                  curveType="natural"
                  opacity={0.42}
                  points={points.current}
                  y0={chartBounds.bottom}
                />
                <Line
                  color="rgba(255,255,255,0.58)"
                  curveType="natural"
                  points={points.previous}
                  strokeWidth={2}
                />
                <Line
                  color="#FFFFFF"
                  curveType="natural"
                  points={points.current}
                  strokeWidth={2.8}
                />
                {isActive ? (
                  <Circle
                    color="#FFFFFF"
                    cx={state.x.position}
                    cy={state.y.current.position}
                    r={4.5}
                  />
                ) : null}
              </>
            )}
          </CartesianChart>
        ) : (
          <View style={styles.noChart}>
            <Text style={styles.noChartText}>No posted spending yet</Text>
          </View>
        )}
      </View>
      <View style={styles.chartAxis}>
        <Text style={styles.chartAxisText}>Day 1</Text>
        <Text style={styles.chartAxisText}>Today · {day}</Text>
      </View>
      <View style={styles.chartFooter}>
        <View style={styles.chartMetricRow}>
          <Text allowFontScaling={false} style={styles.chartMetricStrong}>
            Day {selected.day} · {formatUnsignedMoney(selected.current, currencyCode)}
          </Text>
        </View>
        <Text allowFontScaling={false} style={styles.chartMetric}>
          {delta === 0
            ? 'In line with last month'
            : `${formatUnsignedMoney(Math.abs(delta), currencyCode)} ${delta < 0 ? 'slower' : 'higher'} than last month’s pace`}
        </Text>
      </View>
    </View>
  );
}

function CategoryDonutCard({
  categories,
  colors,
  currencyCode,
  month,
  spent,
}: {
  categories: HomeData['categories'];
  colors: AppColors;
  currencyCode: string;
  month: string;
  spent: number;
}) {
  const data = useMemo(
    () =>
      [...categories].filter((category) => category.spent > 0).sort((a, b) => b.spent - a.spent),
    [categories],
  );
  const categoryTotal = useMemo(
    () => data.reduce((sum, category) => sum + category.spent, 0),
    [data],
  );
  const [chartSize, setChartSize] = useState(0);
  const openAt = useCallback(
    (x: number, y: number) => {
      const center = chartSize / 2;
      const distance = Math.hypot(x - center, y - center);
      if (distance < chartSize * 0.32 || distance > chartSize * 0.5) return;
      const angle = (Math.atan2(y - center, x - center) * 180) / Math.PI;
      const position = (angle + 450) % 360;
      let end = 0;
      const category = data.find((item) => {
        end += (item.spent / categoryTotal) * 360;
        return position <= end;
      });
      if (category)
        router.push({
          pathname: '/category/[name]',
          params: { name: category.name, month },
        });
    },
    [categoryTotal, chartSize, data, month],
  );
  const tap = useMemo(
    () =>
      Gesture.Tap().onEnd((event, success) => {
        if (success) runOnJS(openAt)(event.x, event.y);
      }),
    [openAt],
  );

  return (
    <View
      accessibilityLabel={`Where it went. ${data.map((item) => `${item.name}, ${formatUnsignedMoney(item.spent, currencyCode)}`).join('. ')}`}
      style={[styles.donutCard, { backgroundColor: colors.surface }]}
      testID="home-category-donut"
    >
      <View style={styles.donutHeading}>
        <Text style={[styles.donutTitle, { color: colors.text }]}>Where it went</Text>
        <Text style={[styles.donutTotal, { color: colors.secondary }]}>
          {formatUnsignedMoney(spent, currencyCode)} total
        </Text>
      </View>
      {data.length ? (
        <View style={styles.donutContent}>
          <GestureDetector gesture={tap}>
            <View
              onLayout={(event) => setChartSize(event.nativeEvent.layout.width)}
              style={styles.donutChart}
            >
              <PolarChart data={data} colorKey="color" labelKey="name" valueKey="spent">
                <Pie.Chart innerRadius="66%" startAngle={-90} />
              </PolarChart>
              <View pointerEvents="none" style={styles.donutCenter}>
                <Text
                  allowFontScaling={false}
                  style={[styles.donutCenterValue, { color: colors.text }]}
                >
                  {Math.round((data[0]!.spent / categoryTotal) * 100)}%
                </Text>
                <Text
                  numberOfLines={1}
                  style={[styles.donutCenterLabel, { color: colors.secondary }]}
                >
                  {data[0]!.name}
                </Text>
              </View>
            </View>
          </GestureDetector>
          <View style={styles.donutLegend}>
            {data.slice(0, 4).map((category) => (
              <Pressable
                accessibilityRole="button"
                key={category.name}
                onPress={() =>
                  router.push({
                    pathname: '/category/[name]',
                    params: { name: category.name, month },
                  })
                }
                style={({ pressed }) => [styles.donutLegendRow, { opacity: pressed ? 0.62 : 1 }]}
                testID={`home-donut-category-${category.name}`}
              >
                <View style={[styles.donutLegendDot, { backgroundColor: category.color }]} />
                <Text numberOfLines={1} style={[styles.donutLegendName, { color: colors.text }]}>
                  {category.name}
                </Text>
                <Text
                  allowFontScaling={false}
                  style={[styles.donutLegendAmount, { color: colors.secondary }]}
                >
                  {formatUnsignedMoney(category.spent, currencyCode)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <View style={styles.noChart}>
          <Text style={[styles.emptyText, { color: colors.secondary }]}>
            No spending to show yet.
          </Text>
        </View>
      )}
    </View>
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
        color={over ? colors.danger : colors.positive}
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

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 36 },
  contextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 8,
  },
  monthContext: { flex: 1, minWidth: 0 },
  greeting: { fontSize: 14, lineHeight: 20 },
  freshness: { maxWidth: '56%', fontSize: 13, textAlign: 'right' },
  hero: { paddingTop: 29, paddingBottom: 22 },
  heroValue: {
    fontSize: 56,
    lineHeight: 59,
    fontWeight: '700',
    letterSpacing: -2,
    fontVariant: ['tabular-nums'],
  },
  heroLabel: {
    marginTop: 4,
    fontSize: 25,
    lineHeight: 30,
    fontWeight: '600',
    letterSpacing: -0.45,
  },
  spendingHero: {
    height: 292,
    overflow: 'hidden',
    borderRadius: 25,
    paddingTop: 17,
    paddingHorizontal: 14,
    paddingBottom: 13,
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.22,
    shadowRadius: 22,
  },
  chartHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  chartTitle: { color: '#FFFFFF', fontSize: 15, lineHeight: 20, fontWeight: '700' },
  chartSource: {
    minHeight: 28,
    paddingHorizontal: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.1)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  chartSourceText: { color: 'rgba(255,255,255,0.82)', fontSize: 10.5, fontWeight: '600' },
  chartBody: { height: 176, marginTop: 4 },
  chartGrid: {
    position: 'absolute',
    top: 22,
    right: 2,
    bottom: 18,
    left: 2,
    justifyContent: 'space-between',
  },
  chartGridLine: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  noChart: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  noChartText: { color: 'rgba(255,255,255,0.72)', fontSize: 13 },
  chartAxis: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 3 },
  chartAxisText: { color: 'rgba(255,255,255,0.64)', fontSize: 10.5 },
  chartFooter: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.22)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  chartMetricRow: { flexDirection: 'row', alignItems: 'baseline' },
  chartMetric: { color: 'rgba(255,255,255,0.74)', fontSize: 11 },
  chartMetricStrong: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  carouselFooter: {
    minHeight: 34,
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  carouselLabel: { fontSize: 11.5, fontWeight: '500' },
  pageDots: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pageDot: { width: 6, height: 6, borderRadius: 3 },
  donutCard: { height: 292, borderRadius: 25, padding: 17, overflow: 'hidden' },
  donutHeading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  donutTitle: { fontSize: 17, lineHeight: 22, fontWeight: '700' },
  donutTotal: { fontSize: 12.5, lineHeight: 18, fontWeight: '600', fontVariant: ['tabular-nums'] },
  donutContent: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  donutChart: { width: 156, height: 156 },
  donutCenter: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 38,
  },
  donutCenterValue: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  donutCenterLabel: { marginTop: 1, maxWidth: 76, fontSize: 10.5, lineHeight: 14 },
  donutLegend: { flex: 1, minWidth: 0 },
  donutLegendRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7 },
  donutLegendDot: { width: 8, height: 8, borderRadius: 4 },
  donutLegendName: { flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 17, fontWeight: '600' },
  donutLegendAmount: {
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  cashflowRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 24,
    marginTop: 14,
    paddingHorizontal: 3,
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
  netWorthCopy: { flex: 1, minWidth: 0, marginRight: 12 },
  netWorthChange: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
