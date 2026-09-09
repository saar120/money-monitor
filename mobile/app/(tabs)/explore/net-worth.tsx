import { Area, CartesianChart, Line } from 'victory-native';
import { ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { useMoneyData } from '@/MoneyData';
import { formatMoney, formatUnsignedMoney } from '@/money';
import { chartColors, useAppColors } from '@/theme';

export default function NetWorthScreen() {
  const colors = useAppColors();
  const chart = chartColors(useColorScheme() === 'dark');
  const { home } = useMoneyData();
  if (!home) return null;
  const history = home.netWorthHistory.map((point, index) => ({
    index,
    total: point.total,
    date: point.date,
  }));
  const assets = home.assets ?? home.netWorth;
  const liabilities = home.liabilities ?? 0;
  const compositionTotal = Math.max(assets + liabilities, 1);
  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      testID="net-worth-detail"
    >
      <Text style={[styles.amount, { color: colors.text }]}>
        {formatUnsignedMoney(home.netWorth, home.currencyCode)}
      </Text>
      {home.netWorthChange !== null ? (
        <Text
          style={[
            styles.change,
            { color: home.netWorthChange >= 0 ? colors.accent : colors.danger },
          ]}
        >
          {formatMoney(home.netWorthChange, home.currencyCode)} this month
        </Text>
      ) : null}
      <View
        style={styles.chart}
        accessible
        accessibilityLabel={`Net worth history ending at ${formatUnsignedMoney(home.netWorth, home.currencyCode)}.`}
      >
        {history.length > 1 ? (
          <CartesianChart
            data={history}
            xKey="index"
            yKeys={['total']}
            domainPadding={{ top: 16, bottom: 10 }}
            padding={{ left: 4, right: 4, top: 10, bottom: 4 }}
          >
            {({ points, chartBounds }) => (
              <>
                <Area
                  points={points.total}
                  y0={chartBounds.bottom}
                  color={chart.fill}
                  opacity={0.7}
                  curveType="natural"
                />
                <Line
                  points={points.total}
                  color={chart.primary}
                  strokeWidth={3}
                  curveType="natural"
                />
              </>
            )}
          </CartesianChart>
        ) : (
          <View />
        )}
      </View>
      <View style={styles.historyLabels}>
        {history.length ? (
          <>
            <Text style={[styles.label, { color: colors.secondary }]}>
              {new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' }).format(
                new Date(`${history[0]!.date}T12:00:00Z`),
              )}
            </Text>
            <Text style={[styles.label, { color: colors.secondary }]}>Now</Text>
          </>
        ) : null}
      </View>

      <View style={[styles.rule, { backgroundColor: colors.separator }]} />
      <Text style={[styles.title, { color: colors.text }]}>Composition</Text>
      <View style={[styles.composition, { backgroundColor: colors.dangerSoft }]}>
        <View
          style={[
            styles.assetsFill,
            {
              width: `${Math.min((assets / compositionTotal) * 100, 100)}%`,
              backgroundColor: colors.accent,
            },
          ]}
        />
      </View>
      <View style={styles.compositionLabels}>
        <View>
          <Text style={[styles.label, { color: colors.secondary }]}>Assets</Text>
          <Text style={[styles.value, { color: colors.text }]}>
            {formatUnsignedMoney(assets, home.currencyCode)}
          </Text>
        </View>
        <View style={styles.right}>
          <Text style={[styles.label, { color: colors.secondary }]}>Liabilities</Text>
          <Text style={[styles.value, { color: colors.text }]}>
            {formatUnsignedMoney(liabilities, home.currencyCode)}
          </Text>
        </View>
      </View>
      <Text style={[styles.note, { color: colors.secondary }]}>
        Calculated on your Mac from connected accounts, assets, and liabilities.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 48 },
  amount: {
    marginTop: 18,
    fontSize: 42,
    lineHeight: 49,
    fontWeight: '700',
    letterSpacing: -1.4,
    fontVariant: ['tabular-nums'],
  },
  change: { marginTop: 6, fontSize: 15, lineHeight: 21, fontWeight: '600' },
  chart: { height: 220, marginTop: 24 },
  historyLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 30 },
  title: { fontSize: 21, lineHeight: 27, fontWeight: '700' },
  composition: { height: 10, borderRadius: 5, overflow: 'hidden', marginTop: 18 },
  assetsFill: { height: '100%', borderRadius: 5 },
  compositionLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  right: { alignItems: 'flex-end' },
  label: { fontSize: 12.5 },
  value: { marginTop: 3, fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
  note: { marginTop: 32, fontSize: 13, lineHeight: 19 },
});
