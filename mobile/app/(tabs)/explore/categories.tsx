import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { ConnectionState } from '@/ConnectionState';
import { MonthPicker } from '@/MonthPicker';
import { useExploreHistory, useMoneyData } from '@/MoneyData';
import { formatMoney, formatUnsignedMoney } from '@/money';
import { Sparkline } from '@/Sparkline';
import { useAppColors } from '@/theme';

export default function CategoriesScreen() {
  const colors = useAppColors();
  const { month } = useLocalSearchParams<{ month?: string }>();
  const { home, status } = useMoneyData();
  const { months, loading } = useExploreHistory();
  const currentMonth = months.find((item) => item.month === month) ?? months.at(-1);
  const selected = months.find((item) => item.month === currentMonth?.month) ?? currentMonth;
  if (status !== 'ready' || !home) return <ConnectionState />;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      testID="categories-screen"
    >
      {selected ? (
        <CategoryList
          homeCurrency={home.currencyCode}
          months={months}
          selectedMonth={selected.month}
        />
      ) : (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
          <Text style={[styles.loadingText, { color: colors.secondary }]}>
            {loading ? 'Loading category history…' : 'No category history available.'}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function CategoryList({
  homeCurrency,
  months,
  selectedMonth,
}: {
  homeCurrency: string;
  months: ReturnType<typeof useExploreHistory>['months'];
  selectedMonth: string;
}) {
  const colors = useAppColors();
  const { fontScale } = useWindowDimensions();
  const [selected, setSelected] = useState(selectedMonth);
  const snapshot = months.find((month) => month.month === selected) ?? months.at(-1)!;
  const categories = [...snapshot.categories].sort((a, b) => b.spent - a.spent);
  return (
    <>
      <View style={styles.contextRow}>
        <Text maxFontSizeMultiplier={1.3} style={[styles.contextLabel, { color: colors.secondary }]}>
          {categories.length} active categories
        </Text>
        <MonthPicker
          month={snapshot.month}
          months={months.map((item) => item.month)}
          onSelect={setSelected}
          testID="categories-month-picker"
        />
      </View>
      <View style={styles.list}>
        {categories.map((category) => {
          const delta = category.spent - category.previous;
          const values = months
            .slice(-6)
            .map(
              (month) => month.categories.find((item) => item.name === category.name)?.spent ?? 0,
            );
          return (
            <Pressable
              accessibilityHint={`Opens ${category.name} details for ${snapshot.label}`}
              accessibilityRole="button"
              key={category.name}
              onPress={() =>
                router.push({
                  pathname: '/category/[name]',
                  params: { name: category.name, month: snapshot.month },
                })
              }
              style={({ pressed }) => [
                styles.row,
                { borderBottomColor: colors.separator, opacity: pressed ? 0.68 : 1 },
              ]}
              testID={`category-row-${category.name}`}
            >
              <View style={[styles.mark, { backgroundColor: category.color }]} />
              <View style={styles.copy}>
                <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>
                  {category.name}
                </Text>
                <Text
                  allowFontScaling={false}
                  style={[styles.delta, { color: delta > 0 ? colors.warning : colors.positive }]}
                >
                  {delta === 0 ? 'No change' : formatMoney(delta, homeCurrency)}
                </Text>
              </View>
              {fontScale < 1.5 ? <Sparkline color={category.color} values={values} /> : null}
              <View style={styles.amounts}>
                <Text allowFontScaling={false} style={[styles.amount, { color: colors.text }]}>
                  {formatUnsignedMoney(category.spent, homeCurrency)}
                </Text>
                <Text
                  maxFontSizeMultiplier={1.2}
                  style={[styles.previous, { color: colors.secondary }]}
                >
                  vs. last month
                </Text>
              </View>
              <SymbolView name="chevron.right" size={11} tintColor={colors.tertiary} />
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  contextRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  contextLabel: { flex: 1, fontSize: 13, lineHeight: 18 },
  list: { marginTop: 18 },
  row: {
    minHeight: 76,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mark: { width: 9, height: 38, borderRadius: 5 },
  copy: { flex: 1, minWidth: 0 },
  name: { fontSize: 16, lineHeight: 20, fontWeight: '600' },
  delta: { marginTop: 4, fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  amounts: { minWidth: 86, alignItems: 'flex-end' },
  amount: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  previous: { marginTop: 3, fontSize: 10.5 },
  loading: { minHeight: 260, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 12, fontSize: 14 },
});
