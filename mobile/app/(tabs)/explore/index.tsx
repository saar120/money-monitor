import { router, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { ConnectionState } from '@/ConnectionState';
import { useMoneyData } from '@/MoneyData';
import { formatMoney, formatUnsignedMoney, overviewCashFlow } from '@/money';
import { useAppColors, type AppColors } from '@/theme';

type CardProps = {
  accent?: boolean;
  detail: string;
  href: Href;
  icon: string;
  metric?: string;
  testID: string;
  title: string;
};

export default function ExploreScreen() {
  const colors = useAppColors();
  const { fontScale } = useWindowDimensions();
  const { home, status } = useMoneyData();
  if (status !== 'ready' || !home) return <ConnectionState />;

  const cashFlow = overviewCashFlow(home.income, home.spent);
  const leading = [...home.categories].sort(
    (a, b) => Math.abs(b.spent - b.previous) - Math.abs(a.spent - a.previous),
  )[0];
  const primaryBudget = home.budgets[0];

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
      testID="explore-screen"
    >
      <Text style={[styles.intro, { color: colors.secondary }]}>
        Choose a lens, then follow it to the transactions behind the numbers.
      </Text>

      <ExploreCard
        accent
        detail="See every category, its recent shape, and the merchants driving change."
        href="/explore/categories"
        icon="list.bullet.rectangle.fill"
        metric={`${home.categories.length} active`}
        testID="explore-card-categories"
        title="Categories"
      />

      <View style={[styles.grid, fontScale > 1.3 && styles.gridStack]}>
        <View style={styles.gridItem}>
          <ExploreCard
            detail="Spending mix over time"
            href="/explore/monthly-comparison"
            icon="chart.bar.fill"
            metric={formatUnsignedMoney(home.spent, home.currencyCode)}
            testID="explore-card-monthly"
            title="Monthly"
          />
        </View>
        <View style={styles.gridItem}>
          <ExploreCard
            detail="Plan progress by budget"
            href="/explore/budgets"
            icon="target"
            metric={primaryBudget ? `${Math.round(primaryBudget.usedPercent)}% used` : 'No plan'}
            testID="explore-card-budgets"
            title="Budgets"
          />
        </View>
      </View>

      <ExploreCard
        detail="Posted income and spending across months"
        href="/explore/cash-flow"
        icon="arrow.up.arrow.down"
        metric={formatMoney(cashFlow, home.currencyCode)}
        testID="explore-card-cash-flow"
        title="Cash flow"
      />
      <ExploreCard
        detail="Balance history and asset composition"
        href="/net-worth"
        icon="chart.xyaxis.line"
        metric={formatUnsignedMoney(home.netWorth, home.currencyCode)}
        testID="explore-card-net-worth"
        title="Net worth"
      />

      {leading ? (
        <View style={styles.resumeSection}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Top mover</Text>
          <Pressable
            accessibilityHint={`Opens ${leading.name} category details`}
            accessibilityRole="button"
            onPress={() =>
              router.push({ pathname: '/category/[name]', params: { name: leading.name } })
            }
            style={({ pressed }) => [
              styles.mover,
              { borderColor: colors.separator, opacity: pressed ? 0.7 : 1 },
            ]}
            testID={`explore-category-${leading.name}`}
          >
            <View style={[styles.moverMark, { backgroundColor: leading.color }]} />
            <View style={styles.moverCopy}>
              <Text numberOfLines={1} style={[styles.moverTitle, { color: colors.text }]}>
                {leading.name}
              </Text>
              <Text style={[styles.moverMeta, { color: colors.secondary }]}>
                Open category detail
              </Text>
            </View>
            <Text
              allowFontScaling={false}
              style={[
                styles.moverDelta,
                { color: leading.spent > leading.previous ? colors.warning : colors.positive },
              ]}
            >
              {formatMoney(leading.spent - leading.previous, home.currencyCode)}
            </Text>
            <SymbolView name="chevron.right" size={12} tintColor={colors.tertiary} />
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}

function ExploreCard({ accent = false, detail, href, icon, metric, testID, title }: CardProps) {
  const colors = useAppColors();
  const reduceMotion = useReducedMotion();
  const pressed = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.018 }],
  }));
  const setPressed = (value: number) => {
    pressed.value = reduceMotion ? value : withTiming(value, { duration: value ? 110 : 190 });
  };
  const palette = cardPalette(colors, accent);
  return (
    <Animated.View style={[styles.cardWrap, animatedStyle]}>
      <Pressable
        accessibilityHint={detail}
        accessibilityRole="button"
        onPress={() => router.push(href)}
        onPressIn={() => setPressed(1)}
        onPressOut={() => setPressed(0)}
        style={[styles.card, { backgroundColor: palette.background, borderColor: palette.border }]}
        testID={testID}
      >
        <View style={styles.cardTop}>
          <View style={[styles.icon, { backgroundColor: palette.iconBackground }]}>
            <SymbolView name={icon as never} size={18} tintColor={palette.icon} />
          </View>
          <SymbolView name="chevron.right" size={12} tintColor={palette.secondary} />
        </View>
        <Text style={[styles.cardTitle, { color: palette.text }]}>{title}</Text>
        {metric ? (
          <Text
            allowFontScaling={false}
            numberOfLines={1}
            style={[styles.metric, { color: palette.text }]}
          >
            {metric}
          </Text>
        ) : null}
        <Text style={[styles.cardDetail, { color: palette.secondary }]}>{detail}</Text>
      </Pressable>
    </Animated.View>
  );
}

function cardPalette(colors: AppColors, accent: boolean) {
  return accent
    ? {
        background: colors.chart,
        border: colors.chart,
        iconBackground: 'rgba(255,255,255,0.16)',
        icon: '#FFFFFF',
        text: '#FFFFFF',
        secondary: 'rgba(255,255,255,0.74)',
      }
    : {
        background: colors.surface,
        border: colors.separator,
        iconBackground: colors.accentSoft,
        icon: colors.accent,
        text: colors.text,
        secondary: colors.secondary,
      };
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 40, gap: 12 },
  intro: { marginTop: 4, marginBottom: 10, fontSize: 15, lineHeight: 21 },
  grid: { flexDirection: 'row', gap: 12 },
  gridStack: { flexDirection: 'column' },
  gridItem: { flex: 1 },
  cardWrap: { flex: 1 },
  card: {
    minHeight: 148,
    padding: 17,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardTitle: {
    marginTop: 17,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  metric: {
    marginTop: 5,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  cardDetail: { marginTop: 6, fontSize: 12.5, lineHeight: 17 },
  resumeSection: { marginTop: 18 },
  sectionTitle: { fontSize: 21, lineHeight: 27, fontWeight: '700', letterSpacing: -0.35 },
  mover: {
    minHeight: 68,
    marginTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  moverMark: { width: 7, height: 34, borderRadius: 4 },
  moverCopy: { flex: 1, minWidth: 0 },
  moverTitle: { fontSize: 16, lineHeight: 20, fontWeight: '600' },
  moverMeta: { marginTop: 3, fontSize: 12.5, lineHeight: 17 },
  moverDelta: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
