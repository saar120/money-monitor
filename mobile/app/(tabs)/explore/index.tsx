import { router, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ConnectionState } from '@/ConnectionState';
import { MonthPicker } from '@/MonthPicker';
import { useMoneyData, useOverviewMonth } from '@/MoneyData';
import { formatMoney, formatSpendingChange, formatUnsignedMoney, overviewCashFlow } from '@/money';
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
  const categories = [...home.categories].filter((item) => item.spent > 0).sort((a, b) => b.spent - a.spent);
  const params = { month: selected.month };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
      testID="explore-screen"
    >
      <View style={styles.hero} testID="explore-summary">
        <View style={styles.heroHeader}>
          <Text style={[styles.heroLabel, { color: colors.text }]}>Total spending</Text>
          <MonthPicker
            month={selected.month}
            months={selected.months}
            onSelect={selected.selectMonth}
            testID="explore-month-picker"
          />
        </View>
        <Text
          adjustsFontSizeToFit
          allowFontScaling={false}
          minimumFontScale={0.72}
          numberOfLines={1}
          style={[styles.heroValue, { color: colors.text }]}
        >
          {formatUnsignedMoney(home.spent, home.currencyCode)}
        </Text>
        <Text style={[styles.heroDelta, { color: delta > 0 ? colors.warning : colors.positive }]}>
          {delta === 0 ? 'Unchanged from last month' : `${formatSpendingChange(delta, home.currencyCode)} than last month`}
        </Text>
        <View style={[styles.mixTrack, { backgroundColor: colors.surfaceSoft }]} accessibilityLabel="Spending mix by category">
          {categories.map((category) => (
            <View
              key={category.name}
              style={{ backgroundColor: category.color, flex: Math.max(1, category.spent) }}
            />
          ))}
        </View>
      </View>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Explore your money</Text>
      <View style={[styles.list, { backgroundColor: colors.surface }]}>
        <ExploreRow
          detail="Recent shape, merchants, and transactions"
          href={{ pathname: '/explore/categories', params }}
          icon="list.bullet.rectangle"
          metric={`${home.categories.length}`}
          testID="explore-card-categories"
          title="Categories"
        />
        <ExploreRow
          detail="How the spending mix changes over time"
          href={{ pathname: '/explore/monthly-comparison', params }}
          icon="chart.bar.xaxis"
          metric="6M"
          testID="explore-card-monthly"
          title="Monthly spending"
        />
        <ExploreRow
          detail="Progress against the plans from your Mac"
          href={{ pathname: '/explore/budgets', params }}
          icon="gauge.with.dots.needle.50percent"
          metric={primaryBudget ? `${Math.round(primaryBudget.usedPercent)}%` : '—'}
          testID="explore-card-budgets"
          title="Budgets"
        />
        <ExploreRow
          detail="Posted income compared with spending"
          href="/explore/cash-flow"
          icon="arrow.up.arrow.down"
          metric={formatMoney(overviewCashFlow(home.income, home.spent), home.currencyCode)}
          testID="explore-card-cash-flow"
          title="Cash flow"
        />
        <ExploreRow
          detail="Balance history and asset composition"
          href="/net-worth"
          icon="chart.xyaxis.line"
          last
          metric={formatUnsignedMoney(home.netWorth, home.currencyCode)}
          testID="explore-card-net-worth"
          title="Net worth"
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
        <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text }]}>{title}</Text>
        <Text numberOfLines={1} style={[styles.rowDetail, { color: colors.secondary }]}>{detail}</Text>
      </View>
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.metric, { color: colors.text }]}>
        {metric}
      </Text>
      <SymbolView name="chevron.right" size={10} tintColor={colors.tertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  hero: { marginTop: 4 },
  heroHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  heroLabel: { fontSize: 16, lineHeight: 21, fontWeight: '700' },
  heroValue: {
    marginTop: 18,
    fontSize: 42,
    lineHeight: 49,
    fontWeight: '700',
    letterSpacing: -1.4,
    fontVariant: ['tabular-nums'],
  },
  heroDelta: { marginTop: 4, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  mixTrack: { height: 9, marginTop: 20, borderRadius: 5, overflow: 'hidden', flexDirection: 'row', gap: 1 },
  sectionTitle: { marginTop: 36, marginBottom: 10, fontSize: 21, lineHeight: 27, fontWeight: '700', letterSpacing: -0.35 },
  list: { borderRadius: 18, paddingHorizontal: 14, overflow: 'hidden' },
  row: { minHeight: 75, flexDirection: 'row', alignItems: 'center', gap: 11 },
  icon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 16, lineHeight: 21, fontWeight: '700' },
  rowDetail: { marginTop: 3, fontSize: 11.5, lineHeight: 16 },
  metric: { maxWidth: 88, textAlign: 'right', fontSize: 13.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
