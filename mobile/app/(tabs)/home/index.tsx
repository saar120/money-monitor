import { Area, CartesianChart, Line } from 'victory-native';
import { SymbolView } from 'expo-symbols';
import { RefreshControl, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { ConnectionState } from '@/ConnectionState';
import { useMoneyData } from '@/MoneyData';
import { formatUnsignedMoney } from '@/money';
import { chartColors, useAppColors } from '@/theme';

export default function HomeScreen() {
  const colors = useAppColors();
  const charts = chartColors(useColorScheme() === 'dark');
  const { home, status, reload } = useMoneyData();

  if (status !== 'ready' || !home) return <ConnectionState />;

  const budgetAvailable = home.budget !== null && home.available !== null;
  const used =
    home.budget === null || home.available === null || home.budget === 0
      ? 0
      : home.spent / home.budget;
  const overBudget = home.available !== null && home.available < 0;
  const budgetNeedsAttention = overBudget || !budgetAvailable;
  const day = Number(home.currentDate.slice(8, 10));
  const daysInMonth = new Date(
    Number(home.currentDate.slice(0, 4)),
    Number(home.currentDate.slice(5, 7)),
    0,
  ).getDate();

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
      testID="home-screen"
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={() => void reload()}
          tintColor={colors.accent}
        />
      }
    >
      <View style={styles.monthHeading}>
        <Text style={[styles.month, { color: colors.secondary }]}>
          {home.month} · day {day} of {daysInMonth}
        </Text>
        <View
          style={[
            styles.status,
            { backgroundColor: budgetNeedsAttention ? colors.warningSoft : colors.accentSoft },
          ]}
        >
          <View
            style={[
              styles.statusDot,
              { backgroundColor: budgetNeedsAttention ? colors.warning : colors.accent },
            ]}
          />
          <Text
            style={[
              styles.statusText,
              { color: budgetNeedsAttention ? colors.warning : colors.accent },
            ]}
          >
            {home.budgetStatus}
          </Text>
        </View>
      </View>

      <View style={styles.primaryMetrics} testID="home-primary-money">
        <View style={styles.spendingMetric}>
          <Text style={[styles.metricLabel, { color: colors.secondary }]}>Spent this month</Text>
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            numberOfLines={1}
            style={[styles.spentValue, { color: colors.text }]}
          >
            {formatUnsignedMoney(home.spent, home.currencyCode)}
          </Text>
        </View>
        <View style={[styles.availableMetric, { borderLeftColor: colors.separator }]}>
          <Text style={[styles.metricLabel, { color: colors.secondary }]}>Available</Text>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            style={[styles.availableValue, { color: overBudget ? colors.danger : colors.accent }]}
          >
            {home.available === null
              ? '—'
              : `${overBudget ? '−' : ''}${formatUnsignedMoney(home.available, home.currencyCode)}`}
          </Text>
          <Text style={[styles.metricFootnote, { color: colors.tertiary }]}>
            {home.budget === null
              ? 'No single plan'
              : `of ${formatUnsignedMoney(home.budget, home.currencyCode)}`}
          </Text>
        </View>
      </View>

      <View style={[styles.budgetTrack, { backgroundColor: colors.separator }]}>
        <View
          style={[
            styles.budgetFill,
            {
              backgroundColor: overBudget ? colors.danger : colors.accent,
              width: `${Math.min(used, 1) * 100}%`,
            },
          ]}
        />
      </View>
      <View style={styles.budgetCaption} testID="budget-status">
        <Text style={[styles.captionStrong, { color: colors.text }]}>
          {budgetAvailable ? `${Math.round(used * 100)}% used` : 'Budget unavailable'}
        </Text>
        <Text style={[styles.caption, { color: colors.secondary }]}>{home.budgetNote}</Text>
      </View>

      <SectionRule color={colors.separator} />

      <View testID="net-worth-summary">
        <View style={styles.sectionHeadingRow}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Net worth</Text>
          {home.netWorthChange !== null ? (
            <Text style={[styles.positiveDelta, { color: colors.accent }]}>
              +{formatUnsignedMoney(home.netWorthChange, home.currencyCode)} this month
            </Text>
          ) : (
            <Text style={[styles.sectionMeta, { color: colors.secondary }]}>Calculated on Mac</Text>
          )}
        </View>
        <Text style={[styles.netWorthValue, { color: colors.text }]}>
          {formatUnsignedMoney(home.netWorth, home.currencyCode)}
        </Text>
        {home.assets !== null && home.liabilities !== null ? (
          <View style={styles.netWorthBreakdown}>
            <Text style={[styles.breakdownText, { color: colors.secondary }]}>
              Assets {formatUnsignedMoney(home.assets, home.currencyCode)}
            </Text>
            <View style={[styles.inlineDivider, { backgroundColor: colors.separator }]} />
            <Text style={[styles.breakdownText, { color: colors.secondary }]}>
              Liabilities {formatUnsignedMoney(home.liabilities, home.currencyCode)}
            </Text>
          </View>
        ) : null}
      </View>

      {home.categories.length > 0 ? (
        <>
          <SectionRule color={colors.separator} />
          <View testID="category-spending">
            <View style={styles.sectionHeadingRow}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                Spending by category
              </Text>
              <Text style={[styles.sectionMeta, { color: colors.secondary }]}>spent / plan</Text>
            </View>
            <View style={styles.categoryList}>
              {home.categories.map((category) => {
                const ratio = category.budget === 0 ? 0 : category.spent / category.budget;
                const categoryOver = ratio > 1;
                return (
                  <View key={category.name} style={styles.categoryRow}>
                    <View style={styles.categoryLabels}>
                      <Text style={[styles.categoryName, { color: colors.text }]}>
                        {category.name}
                      </Text>
                      <Text
                        style={[
                          styles.categoryAmount,
                          { color: categoryOver ? colors.danger : colors.secondary },
                        ]}
                      >
                        {formatUnsignedMoney(category.spent, home.currencyCode)} /{' '}
                        {formatUnsignedMoney(category.budget, home.currencyCode)}
                      </Text>
                    </View>
                    <View style={[styles.categoryTrack, { backgroundColor: colors.separator }]}>
                      <View
                        style={[
                          styles.categoryFill,
                          {
                            width: `${Math.min(ratio, 1) * 100}%`,
                            backgroundColor: categoryOver ? colors.danger : category.color,
                          },
                        ]}
                      />
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        </>
      ) : null}

      {home.trend.length > 0 ? (
        <>
          <SectionRule color={colors.separator} />
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={`Spending pace chart. ${home.month} spending is ${formatUnsignedMoney(home.spent, home.currencyCode)} through day ${day}, compared with the previous month.`}
            testID="cash-flow-trend"
          >
            <View style={styles.sectionHeadingRow}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Spending pace</Text>
              <View style={styles.legend}>
                <View style={[styles.legendLine, { backgroundColor: charts.primary }]} />
                <Text style={[styles.legendText, { color: colors.secondary }]}>
                  {home.month.slice(0, 3)}
                </Text>
                <View style={[styles.legendLine, { backgroundColor: charts.previous }]} />
                <Text style={[styles.legendText, { color: colors.secondary }]}>Previous</Text>
              </View>
            </View>
            <View style={styles.chart}>
              <CartesianChart
                data={home.trend}
                xKey="day"
                yKeys={['current', 'previous']}
                domain={{
                  y: [0, Math.max(...home.trend.map((point) => point.previous), home.spent) * 1.08],
                }}
                padding={{ top: 10, bottom: 4, left: 3, right: 3 }}
              >
                {({ points, chartBounds }) => (
                  <>
                    <Area
                      points={points.current}
                      y0={chartBounds.bottom}
                      color={charts.fill}
                      opacity={0.72}
                      curveType="natural"
                    />
                    <Line
                      points={points.previous}
                      color={charts.previous}
                      strokeWidth={1.5}
                      opacity={0.85}
                      curveType="natural"
                    />
                    <Line
                      points={points.current}
                      color={charts.primary}
                      strokeWidth={3}
                      curveType="natural"
                    />
                  </>
                )}
              </CartesianChart>
            </View>
            <View style={styles.dayLabels}>
              {['1', '7', '14', '21', String(daysInMonth)].map((label) => (
                <Text key={label} style={[styles.dayLabel, { color: colors.tertiary }]}>
                  {label}
                </Text>
              ))}
            </View>
          </View>
        </>
      ) : null}

      <SectionRule color={colors.separator} />

      <View testID="account-freshness">
        <View style={styles.sectionHeadingRow}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Account freshness</Text>
          <SymbolView name="arrow.clockwise" size={15} tintColor={colors.secondary} />
        </View>
        <View style={styles.freshnessList}>
          {home.freshness.map((item) => {
            const stateColor =
              item.state === 'fresh'
                ? colors.accent
                : item.state === 'aging'
                  ? colors.warning
                  : colors.danger;
            return (
              <View key={item.account} style={styles.freshnessRow}>
                <View style={[styles.freshnessDot, { backgroundColor: stateColor }]} />
                <Text style={[styles.freshnessAccount, { color: colors.text }]}>
                  {item.account}
                </Text>
                <Text
                  style={[
                    styles.freshnessDetail,
                    { color: item.state === 'stale' ? colors.danger : colors.secondary },
                  ]}
                >
                  {item.detail}
                </Text>
              </View>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}

function SectionRule({ color }: { color: string }) {
  return <View style={[styles.sectionRule, { backgroundColor: color }]} />;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 44 },
  monthHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  month: { fontSize: 15, fontWeight: '500' },
  status: {
    minHeight: 30,
    borderRadius: 15,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 13, fontWeight: '600' },
  primaryMetrics: { flexDirection: 'row', alignItems: 'stretch', marginTop: 27 },
  spendingMetric: { flex: 1, paddingRight: 18 },
  availableMetric: {
    flex: 0.43,
    minWidth: 118,
    borderLeftWidth: StyleSheet.hairlineWidth,
    paddingLeft: 18,
    justifyContent: 'flex-end',
  },
  metricLabel: { fontSize: 14, fontWeight: '500', marginBottom: 5 },
  spentValue: {
    fontSize: 43,
    lineHeight: 49,
    fontWeight: '700',
    letterSpacing: -1.6,
    fontVariant: ['tabular-nums'],
  },
  availableValue: {
    fontSize: 25,
    lineHeight: 31,
    fontWeight: '700',
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
  },
  metricFootnote: { fontSize: 12, marginTop: 2, fontVariant: ['tabular-nums'] },
  budgetTrack: { height: 5, borderRadius: 3, overflow: 'hidden', marginTop: 22 },
  budgetFill: { height: '100%', borderRadius: 3 },
  budgetCaption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 9,
  },
  captionStrong: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  caption: { fontSize: 13 },
  sectionRule: { height: StyleSheet.hairlineWidth, marginVertical: 29 },
  sectionHeadingRow: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: { fontSize: 19, lineHeight: 24, fontWeight: '700', letterSpacing: -0.25 },
  sectionMeta: { fontSize: 12 },
  positiveDelta: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  netWorthValue: {
    marginTop: 14,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '700',
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  netWorthBreakdown: { flexDirection: 'row', alignItems: 'center', marginTop: 7 },
  breakdownText: { fontSize: 13, fontVariant: ['tabular-nums'] },
  inlineDivider: { width: StyleSheet.hairlineWidth, height: 12, marginHorizontal: 10 },
  categoryList: { marginTop: 17, gap: 16 },
  categoryRow: { gap: 7 },
  categoryLabels: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  categoryName: { fontSize: 15, fontWeight: '500' },
  categoryAmount: { fontSize: 13, fontVariant: ['tabular-nums'] },
  categoryTrack: { height: 5, borderRadius: 3, overflow: 'hidden' },
  categoryFill: { height: '100%', borderRadius: 3 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendLine: { width: 14, height: 2, borderRadius: 1, marginLeft: 5 },
  legendText: { fontSize: 12 },
  chart: { height: 142, marginTop: 14 },
  dayLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  dayLabel: { fontSize: 11, fontVariant: ['tabular-nums'] },
  freshnessList: { marginTop: 13 },
  freshnessRow: { minHeight: 43, flexDirection: 'row', alignItems: 'center' },
  freshnessDot: { width: 7, height: 7, borderRadius: 4, marginRight: 10 },
  freshnessAccount: { flex: 1, fontSize: 15, fontWeight: '500' },
  freshnessDetail: { fontSize: 12.5, marginLeft: 10 },
});
