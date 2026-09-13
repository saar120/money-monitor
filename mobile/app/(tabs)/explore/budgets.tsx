import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ConnectionState } from '@/ConnectionState';
import { MonthNavigator } from '@/MonthNavigator';
import { useExploreHistory, useMoneyData } from '@/MoneyData';
import { formatUnsignedMoney } from '@/money';
import type { ExploreMonth } from '@/mobile-api';
import { useAppColors } from '@/theme';

export default function BudgetsScreen() {
  const colors = useAppColors();
  const { home, status } = useMoneyData();
  const { months, loading } = useExploreHistory();
  if (status !== 'ready' || !home) return <ConnectionState />;
  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      testID="budgets-screen"
    >
      {months.length ? <BudgetList months={months} /> : <Loading loading={loading} />}
    </ScrollView>
  );
}

function BudgetList({ months }: { months: ExploreMonth[] }) {
  const colors = useAppColors();
  const [month, setMonth] = useState(months.at(-1)!.month);
  const selected = months.find((item) => item.month === month) ?? months.at(-1)!;
  return (
    <>
      <MonthNavigator months={months} onChange={setMonth} value={selected.month} />
      <Text style={[styles.note, { color: colors.secondary }]}>
        Plan limits stay fixed; progress reflects posted spending for the selected month.
      </Text>
      {selected.budgets.length ? (
        <View style={styles.list}>
          {selected.budgets.map((budget) => {
            const statusColor =
              budget.status === 'over_budget'
                ? colors.danger
                : budget.status === 'watch'
                  ? colors.warning
                  : colors.positive;
            return (
              <View key={budget.name} style={[styles.row, { borderBottomColor: colors.separator }]}>
                <View style={styles.heading}>
                  <View style={styles.copy}>
                    <Text style={[styles.name, { color: colors.text }]}>{budget.name}</Text>
                    <Text style={[styles.meta, { color: colors.secondary }]}>
                      {formatUnsignedMoney(budget.spent, selected.currencyCode)} of{' '}
                      {formatUnsignedMoney(budget.limit, selected.currencyCode)}
                    </Text>
                  </View>
                  <View style={styles.trailing}>
                    <Text allowFontScaling={false} style={[styles.percent, { color: statusColor }]}>
                      {Math.round(budget.usedPercent)}%
                    </Text>
                    <Text style={[styles.remaining, { color: colors.secondary }]}>
                      {formatUnsignedMoney(Math.abs(budget.remaining), selected.currencyCode)}{' '}
                      {budget.remaining < 0 ? 'over' : 'left'}
                    </Text>
                  </View>
                </View>
                <View style={[styles.track, { backgroundColor: colors.separator }]}>
                  <View
                    style={[
                      styles.fill,
                      {
                        backgroundColor: statusColor,
                        width: `${Math.min(100, budget.usedPercent)}%`,
                      },
                    ]}
                  />
                  <View
                    style={[
                      styles.elapsed,
                      {
                        backgroundColor: colors.secondary,
                        left: `${Math.min(100, budget.elapsedPercent)}%`,
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.pace, { color: colors.secondary }]}>
                  Month {Math.round(budget.elapsedPercent)}% elapsed
                </Text>
              </View>
            );
          })}
        </View>
      ) : (
        <View style={[styles.empty, { backgroundColor: colors.surfaceSoft }]}>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No budgets for this month</Text>
          <Text style={[styles.emptyText, { color: colors.secondary }]}>
            Budget setup stays on your Mac.
          </Text>
        </View>
      )}
    </>
  );
}

function Loading({ loading }: { loading: boolean }) {
  const colors = useAppColors();
  return (
    <View style={styles.loading}>
      {loading ? <ActivityIndicator color={colors.accent} /> : null}
      <Text style={[styles.loadingText, { color: colors.secondary }]}>
        {loading ? 'Loading budgets…' : 'Budget history is unavailable.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  note: { marginTop: 16, fontSize: 13, lineHeight: 18 },
  list: { marginTop: 18 },
  row: { paddingVertical: 22, borderBottomWidth: StyleSheet.hairlineWidth },
  heading: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  copy: { flex: 1, minWidth: 0 },
  name: { fontSize: 17, lineHeight: 22, fontWeight: '700' },
  meta: { marginTop: 4, fontSize: 12.5, lineHeight: 17 },
  trailing: { alignItems: 'flex-end' },
  percent: { fontSize: 19, lineHeight: 23, fontWeight: '700', fontVariant: ['tabular-nums'] },
  remaining: { marginTop: 3, fontSize: 11.5 },
  track: { height: 8, marginTop: 16, borderRadius: 4 },
  fill: { height: 8, borderRadius: 4 },
  elapsed: { position: 'absolute', top: -2, width: 2, height: 12, borderRadius: 1 },
  pace: { marginTop: 8, fontSize: 11.5 },
  empty: { marginTop: 24, padding: 20, borderRadius: 18 },
  emptyTitle: { fontSize: 17, fontWeight: '700' },
  emptyText: { marginTop: 5, fontSize: 13, lineHeight: 18 },
  loading: { minHeight: 260, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 12, fontSize: 14 },
});
