import { DirectionalChevron } from '@/DirectionalChevron';
import { t } from '@/localization';
import { Text } from '@/LocalizedText';
import { categoryLabel } from '@/translations';
import { router, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ConnectionState } from '@/ConnectionState';
import { MonthPicker } from '@/MonthPicker';
import { useMoneyData, useOverviewMonth } from '@/MoneyData';
import {
  formatMoney,
  formatSpendingComparison,
  formatUnsignedMoney,
  overviewCashFlow,
} from '@/money';
import { useAppColors } from '@/theme';

type ExploreRowProps = {
  detail: string;
  href: Href;
  icon: string;
  last?: boolean;
  metric: string;
  testID: string;
  title: string;
};

export default function ExploreScreen() {
  const colors = useAppColors();
  const { status } = useMoneyData();
  const selected = useOverviewMonth();
  const home = selected.overview;
  if (status !== 'ready' || !home) return <ConnectionState />;

  const primaryBudget = home.budgets[0];
  const delta = home.spent - home.previousSpent;
  const categories = [...home.categories]
    .filter((item) => item.spent > 0)
    .sort((a, b) => b.spent - a.spent);
  const params = { month: selected.month };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
      testID="explore-screen"
    >
      <View style={styles.pageHeader}>
        <Text accessibilityRole="header" style={[styles.pageTitle, { color: colors.text }]}>
          {t('explore')}
        </Text>
        <MonthPicker
          month={selected.month}
          months={selected.months}
          onSelect={selected.selectMonth}
          testID="explore-month-picker"
        />
      </View>
      <View style={styles.hero} testID="explore-summary">
        <Text style={[styles.heroLabel, { color: colors.secondary }]}>{t('whereItWent')}</Text>
        <Text
          adjustsFontSizeToFit
          allowFontScaling={false}
          minimumFontScale={0.72}
          numberOfLines={1}
          style={[styles.heroValue, { color: colors.text }]}
        >
          {formatUnsignedMoney(home.spent, home.currencyCode)}
        </Text>
        <Text style={[styles.heroDelta, { color: colors.secondary }]}>
          {delta === 0
            ? t('unchangedFromLastMonth')
            : formatSpendingComparison(delta, home.currencyCode)}
        </Text>
        {categories.length ? (
          <View
            style={[styles.mixTrack, { backgroundColor: colors.surfaceSoft }]}
            accessibilityLabel={t('spendingMixByCategory')}
          >
            {categories.map((category) => (
              <View
                key={category.name}
                style={{ backgroundColor: category.color, flex: Math.max(1, category.spent) }}
              />
            ))}
          </View>
        ) : (
          <Text style={[styles.heroDelta, { color: colors.secondary }]}>
            {t('noSpendingToShowYet')}
          </Text>
        )}
        <View style={styles.mixLegend} testID="explore-category-legend">
          {categories.map((category) => (
            <View key={category.name} style={styles.legendItem}>
              <View style={[styles.legendMark, { backgroundColor: category.color }]} />
              <Text style={[styles.legendLabel, { color: colors.secondary }]}>
                {categoryLabel(category.name)}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('exploreYourMoney')}</Text>
      <View style={[styles.list, { backgroundColor: colors.surface }]}>
        <ExploreRow
          detail={t('recentShapeMerchantsAndTransactions')}
          href={{ pathname: '/explore/categories', params }}
          icon="list.bullet.rectangle"
          metric={`${home.categories.length}`}
          testID="explore-card-categories"
          title={t('categories')}
        />
        <ExploreRow
          detail={t('howTheSpendingMixChangesOverTime')}
          href={{ pathname: '/explore/monthly-comparison', params }}
          icon="chart.bar.xaxis"
          metric={t('message6M')}
          testID="explore-card-monthly"
          title={t('monthlySpending')}
        />
        <ExploreRow
          detail={t('progressAgainstThePlansFromYourMac')}
          href={{ pathname: '/explore/budgets', params }}
          icon="gauge.with.dots.needle.50percent"
          metric={primaryBudget ? `${Math.round(primaryBudget.usedPercent)}%` : '-'}
          testID="explore-card-budgets"
          title={t('budgets')}
        />
        <ExploreRow
          detail={t('postedIncomeComparedWithSpending')}
          href="/explore/cash-flow"
          icon="arrow.up.arrow.down"
          metric={formatMoney(overviewCashFlow(home.income, home.spent), home.currencyCode)}
          testID="explore-card-cash-flow"
          title={t('cashFlow')}
        />
        <ExploreRow
          detail={t('membershipsAndServiceBills')}
          href="/explore/recurring-payments"
          icon="repeat"
          metric=""
          testID="explore-card-recurring"
          title={t('subscriptions')}
        />
        <ExploreRow
          detail={t('balanceHistoryAndAssetComposition')}
          href="/net-worth"
          icon="chart.xyaxis.line"
          last
          metric={formatUnsignedMoney(home.netWorth, home.currencyCode)}
          testID="explore-card-net-worth"
          title={t('netWorth')}
        />
      </View>
    </ScrollView>
  );
}

function ExploreRow({ detail, href, icon, last = false, metric, testID, title }: ExploreRowProps) {
  const colors = useAppColors();
  return (
    <Pressable
      accessibilityHint={detail}
      accessibilityRole="button"
      onPress={() => router.push(href)}
      style={({ pressed }) => [
        styles.row,
        {
          borderBottomColor: colors.separator,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
          opacity: pressed ? 0.62 : 1,
        },
      ]}
      testID={testID}
    >
      <View style={[styles.icon, { backgroundColor: colors.accentSoft }]}>
        <SymbolView name={icon as never} size={17} tintColor={colors.accent} />
      </View>
      <View style={styles.copy}>
        <View style={styles.rowHeading}>
          <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text }]}>
            {title}
          </Text>
          <Text
            allowFontScaling={false}
            numberOfLines={1}
            style={[styles.metric, { color: colors.text }]}
          >
            {metric}
          </Text>
        </View>
        <Text style={[styles.rowDetail, { color: colors.secondary }]}>{detail}</Text>
      </View>
      <DirectionalChevron direction="forward" size={10} tintColor={colors.tertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  pageHeader: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  pageTitle: {
    flexShrink: 1,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    letterSpacing: -0.7,
  },
  hero: { marginTop: 28 },
  heroLabel: { fontSize: 15, lineHeight: 21, fontWeight: '500' },
  heroValue: {
    marginTop: 8,
    fontSize: 42,
    lineHeight: 49,
    fontWeight: '600',
    letterSpacing: -1.4,
    fontVariant: ['tabular-nums'],
  },
  heroDelta: { marginTop: 6, fontSize: 14, lineHeight: 20 },
  mixTrack: {
    height: 8,
    marginTop: 20,
    borderRadius: 5,
    overflow: 'hidden',
    flexDirection: 'row',
    gap: 1,
  },
  mixLegend: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendMark: { width: 7, height: 7, borderRadius: 2 },
  legendLabel: { fontSize: 12, lineHeight: 17 },
  sectionTitle: {
    marginTop: 30,
    marginBottom: 14,
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '700',
    letterSpacing: -0.35,
  },
  list: { borderRadius: 20, paddingHorizontal: 16, overflow: 'hidden' },
  row: { minHeight: 84, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0 },
  rowHeading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  rowTitle: { flexShrink: 1, fontSize: 16, lineHeight: 21, fontWeight: '600' },
  rowDetail: { marginTop: 4, fontSize: 13, lineHeight: 18 },
  metric: {
    maxWidth: 130,
    textAlign: 'right',
    fontSize: 13.5,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
