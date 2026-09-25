import { t, useLanguage } from '@/localization';
import { currentLocale, formatMonthShort } from '@/locale-state';
import { Text } from '@/LocalizedText';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ConnectionState } from '@/ConnectionState';
import { GlassSegmentedControl } from '@/GlassSegmentedControl';
import { useExploreHistory, useMoneyData } from '@/MoneyData';
import { cashFlowSummary, formatMoney, formatUnsignedMoney, overviewCashFlow } from '@/money';
import type { ExploreMonth } from '@/mobile-api';
import { useAppColors } from '@/theme';

type Range = '3' | '6' | '12';

export default function CashFlowScreen() {
  const colors = useAppColors();
  const { home, status } = useMoneyData();
  const { months, loading } = useExploreHistory();
  if (status !== 'ready' || !home) return <ConnectionState />;
  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      testID="cash-flow-screen"
    >
      {months.length ? <CashFlowChart months={months} /> : <Loading loading={loading} />}
    </ScrollView>
  );
}

function CashFlowChart({ months }: { months: ExploreMonth[] }) {
  const colors = useAppColors();
  const { language } = useLanguage();
  const [range, setRange] = useState<Range>('6');
  const [selectedMonth, setSelectedMonth] = useState(months.at(-1)!.month);
  const series = months.slice(-Number(range));
  const selected = months.find((month) => month.month === selectedMonth) ?? months.at(-1)!;
  const index = months.findIndex((month) => month.month === selected.month);
  const previous = index > 0 ? months[index - 1] : null;
  const net = overviewCashFlow(selected.income, selected.spending);
  const previousNet = previous ? overviewCashFlow(previous.income, previous.spending) : null;
  const delta = previousNet === null ? null : net - previousNet;
  const max = Math.max(1, ...series.flatMap((month) => [month.income, month.spending]));
  const summary = cashFlowSummary(series);
  const rangeLabel = t('monthCount', { count: series.length });

  return (
    <>
      <GlassSegmentedControl
        compact
        onChange={setRange}
        options={[
          { label: t('message3M'), value: '3' },
          { label: t('message6M'), value: '6' },
          { label: t('message1Y'), value: '12' },
        ]}
        testID="cash-flow-range"
        value={range}
      />

      <Text style={[styles.month, { color: colors.secondary }]}>{monthTitle(selected.month)}</Text>
      <Text
        allowFontScaling={false}
        style={[styles.net, { color: net >= 0 ? colors.positive : colors.danger }]}
        testID="cash-flow-total"
      >
        {formatMoney(net, selected.currencyCode)}
      </Text>
      <Text style={[styles.delta, { color: colors.secondary }]}>
        {delta === null
          ? t('postedIncomeMinusSpending')
          : t(delta >= 0 ? 'betterThanPreviousMonth' : 'worseThanPreviousMonth', {
              amount: formatUnsignedMoney(Math.abs(delta), selected.currencyCode),
            })}
      </Text>

      <View style={styles.chart} accessibilityLabel={t('incomeAndSpendingByMonth')}>
        {series.map((month) => (
          <Pressable
            accessibilityLabel={t('monthIncomeSpending', {
              month: monthTitle(month.month),
              income: formatUnsignedMoney(month.income, month.currencyCode),
              spending: formatUnsignedMoney(month.spending, month.currencyCode),
            })}
            accessibilityRole="button"
            key={month.month}
            onPress={() => setSelectedMonth(month.month)}
            style={styles.group}
          >
            <View style={[styles.pair, language === 'he' && { direction: 'rtl' }]}>
              <View
                style={[
                  styles.bar,
                  {
                    backgroundColor: colors.accent,
                    height: Math.max(5, (month.income / max) * 166),
                    opacity: selected.month === month.month ? 1 : 0.76,
                  },
                ]}
              />
              <View
                style={[
                  styles.bar,
                  {
                    backgroundColor: colors.blueSoft,
                    height: Math.max(5, (month.spending / max) * 166),
                    opacity: selected.month === month.month ? 1 : 0.76,
                  },
                ]}
              />
            </View>
            <Text
              style={[
                styles.monthLabel,
                { color: selected.month === month.month ? colors.text : colors.secondary },
              ]}
            >
              {formatMonthShort(month.month)}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.legend}>
        <Legend color={colors.accent} label={t('postedIncome')} />
        <Legend color={colors.blueSoft} label={t('postedSpending')} />
      </View>
      <View style={[styles.rule, { backgroundColor: colors.separator }]} />
      <Text style={[styles.sectionLabel, { color: colors.secondary }]}>{t('selectedMonth')}</Text>
      <View style={styles.breakdown}>
        <Value
          label={t('income')}
          value={formatUnsignedMoney(selected.income, selected.currencyCode)}
        />
        <Value
          label={t('spending')}
          value={formatUnsignedMoney(selected.spending, selected.currencyCode)}
        />
      </View>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        {t('rangeSummary', { range: rangeLabel })}
      </Text>
      <View style={[styles.summaryCard, { backgroundColor: colors.surfaceSoft }]}>
        <SummaryRow
          label={t('netCashFlow')}
          testID="cash-flow-range-total"
          value={formatMoney(summary.total, selected.currencyCode)}
          valueColor={summary.total >= 0 ? colors.positive : colors.danger}
        />
        <SummaryRow
          label={t('monthlyAverage')}
          testID="cash-flow-range-average"
          value={formatMoney(summary.average, selected.currencyCode)}
          valueColor={summary.average >= 0 ? colors.positive : colors.danger}
        />
        <SummaryRow
          label={t('totalIncome')}
          value={formatUnsignedMoney(summary.income, selected.currencyCode)}
        />
        <SummaryRow
          label={t('totalSpending')}
          value={formatUnsignedMoney(summary.spending, selected.currencyCode)}
          last
        />
      </View>
    </>
  );
}

function SummaryRow({
  label,
  last = false,
  testID,
  value,
  valueColor,
}: {
  label: string;
  last?: boolean;
  testID?: string;
  value: string;
  valueColor?: string;
}) {
  const colors = useAppColors();
  return (
    <View
      style={[
        styles.summaryRow,
        {
          borderBottomColor: colors.separator,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        },
      ]}
      testID={testID}
    >
      <Text style={[styles.summaryLabel, { color: colors.secondary }]}>{label}</Text>
      <Text
        allowFontScaling={false}
        style={[styles.summaryValue, { color: valueColor ?? colors.text }]}
      >
        {value}
      </Text>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  const colors = useAppColors();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.legendText, { color: colors.secondary }]}>{label}</Text>
    </View>
  );
}

function Value({ label, value }: { label: string; value: string }) {
  const colors = useAppColors();
  return (
    <View>
      <Text style={[styles.valueLabel, { color: colors.secondary }]}>{label}</Text>
      <Text allowFontScaling={false} style={[styles.value, { color: colors.text }]}>
        {value}
      </Text>
    </View>
  );
}

function Loading({ loading }: { loading: boolean }) {
  const colors = useAppColors();
  return (
    <View style={styles.loading}>
      {loading ? <ActivityIndicator color={colors.accent} /> : null}
      <Text style={[styles.loadingText, { color: colors.secondary }]}>
        {loading ? t('loadingCashFlow') : t('cashFlowHistoryIsUnavailable')}
      </Text>
    </View>
  );
}

function monthTitle(month: string) {
  return new Intl.DateTimeFormat(currentLocale(), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T12:00:00Z`));
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  month: { marginTop: 28, fontSize: 14, fontWeight: '600' },
  net: {
    marginTop: 3,
    fontSize: 42,
    lineHeight: 49,
    fontWeight: '700',
    letterSpacing: -1.4,
    fontVariant: ['tabular-nums'],
  },
  delta: { marginTop: 6, fontSize: 13, lineHeight: 18 },
  chart: {
    height: 218,
    marginTop: 26,
    direction: 'ltr',
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 7,
  },
  group: { flex: 1, height: 218, alignItems: 'center', justifyContent: 'flex-end' },
  pair: { height: 172, flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  bar: { minWidth: 6, maxWidth: 16, flex: 1, borderRadius: 4 },
  monthLabel: { marginTop: 8, fontSize: 10.5, fontWeight: '600' },
  legend: { marginTop: 14, flexDirection: 'row', gap: 18 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11.5 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 30 },
  breakdown: { flexDirection: 'row', justifyContent: 'space-between' },
  sectionLabel: {
    marginBottom: 12,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  valueLabel: { fontSize: 13 },
  value: { marginTop: 5, fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  sectionTitle: {
    marginTop: 32,
    marginBottom: 12,
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '700',
  },
  summaryCard: { paddingHorizontal: 14, borderRadius: 16 },
  summaryRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  summaryLabel: { fontSize: 13 },
  summaryValue: {
    flexShrink: 1,
    textAlign: 'right',
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  loading: { minHeight: 260, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 12, fontSize: 14 },
});
