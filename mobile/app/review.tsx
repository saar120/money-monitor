import * as Haptics from 'expo-haptics';
import { Stack, router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CategoryPickerSheet } from '@/CategoryPickerSheet';
import { useActivityTransactions, useMoneyData } from '@/MoneyData';
import type { Transaction } from '@/fixtures';
import { formatMoney } from '@/money';
import { getReviewViewState } from '@/review-state';
import { useAppColors, type AppColors } from '@/theme';
import type { TransactionUpdate } from '@/mobile-api';

export default function ReviewScreen() {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const { home, reload, saveTransaction, loadReviewOptions } = useMoneyData();
  const { transactions, loading, error } = useActivityTransactions('', 'review');
  const [dismissedIds, setDismissedIds] = useState(() => new Set<string>());
  const [overrides, setOverrides] = useState<
    Record<string, Partial<Pick<Transaction, 'included' | 'owner'>>>
  >({});
  const queue = transactions.filter((transaction) => !dismissedIds.has(transaction.id));
  const sourceCurrent = queue[0] ?? null;
  const current = sourceCurrent ? { ...sourceCurrent, ...overrides[sourceCurrent.id] } : null;
  const [sessionTotal, setSessionTotal] = useState(home?.reviewCount ?? 0);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<'category' | 'owner' | null>(null);
  const [options, setOptions] = useState({ categories: [] as string[], owners: [] as string[] });
  const [saveError, setSaveError] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(1)).current;
  const initializedQueue = useRef(false);

  useEffect(() => {
    if (transactions.length > sessionTotal) setSessionTotal(transactions.length);
  }, [sessionTotal, transactions.length]);
  useEffect(() => {
    if (initializedQueue.current || loading || error) return;
    initializedQueue.current = true;
    setSessionTotal(transactions.length);
  }, [error, loading, transactions.length]);
  useEffect(() => {
    void loadReviewOptions()
      .then(setOptions)
      .catch((caught) =>
        setSaveError(
          caught instanceof Error ? caught.message : 'Review options could not be loaded.',
        ),
      );
  }, [loadReviewOptions]);

  async function complete(update: TransactionUpdate) {
    if (!current || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (!reduceMotion)
        await new Promise<void>((resolve) =>
          Animated.timing(opacity, { toValue: 0, duration: 120, useNativeDriver: true }).start(() =>
            resolve(),
          ),
        );
      setDismissedIds((ids) => new Set(ids).add(current.id));
      if (reduceMotion) opacity.setValue(1);
      else {
        opacity.setValue(0);
        Animated.spring(opacity, {
          toValue: 1,
          damping: 18,
          stiffness: 220,
          mass: 0.7,
          useNativeDriver: true,
        }).start();
      }
      await saveTransaction(current.id, update);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (caught) {
      if (current) {
        setDismissedIds((ids) => {
          const next = new Set(ids);
          next.delete(current.id);
          return next;
        });
      }
      opacity.setValue(1);
      setSaveError(
        caught instanceof Error ? caught.message : 'This transaction could not be saved.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveField(
    transaction: Transaction,
    update: Pick<TransactionUpdate, 'included'> | Pick<TransactionUpdate, 'owner'>,
  ) {
    if (saving) return;
    const previous = overrides[transaction.id];
    setSaving(true);
    setOverrides((values) => ({
      ...values,
      [transaction.id]: { ...values[transaction.id], ...update },
    }));
    setSaveError(null);
    try {
      await saveTransaction(transaction.id, update);
      await Haptics.selectionAsync();
    } catch (caught) {
      setOverrides((values) => ({ ...values, [transaction.id]: previous ?? {} }));
      setSaveError(
        caught instanceof Error ? caught.message : 'This transaction could not be saved.',
      );
    } finally {
      setSaving(false);
    }
  }

  const reviewed = dismissedIds.size;
  const remaining = Math.max(0, sessionTotal - reviewed);
  const progress = sessionTotal ? reviewed / sessionTotal : 1;
  const viewState = getReviewViewState({
    loading,
    saving,
    hasCurrent: current !== null,
    hasError: Boolean(error),
    remaining,
  });

  return (
    <>
      <Stack.Screen options={{ title: 'Review', headerBackTitle: 'Back' }} />
      <View
        style={[
          styles.screen,
          { backgroundColor: colors.background, paddingBottom: Math.max(insets.bottom, 12) },
        ]}
        testID="review-screen"
      >
        <View style={styles.progressHeader}>
          <Text style={[styles.progressText, { color: colors.secondary }]}>
            {saving && !current
              ? 'Saving changes…'
              : remaining
                ? `${remaining} to review`
                : 'Inbox zero'}
          </Text>
          <Text style={[styles.progressCount, { color: colors.secondary }]}>
            {reviewed}/{sessionTotal || reviewed}
          </Text>
        </View>
        <View style={[styles.progressTrack, { backgroundColor: colors.separator }]}>
          <View
            style={[
              styles.progressFill,
              { backgroundColor: colors.accent, width: `${progress * 100}%` },
            ]}
          />
        </View>

        {viewState === 'loading' ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
            <Text style={{ color: colors.secondary }}>Loading review queue…</Text>
          </View>
        ) : viewState === 'error' ? (
          <View style={styles.caughtUp} testID="review-error">
            <SymbolView name="exclamationmark.triangle.fill" size={44} tintColor={colors.warning} />
            <Text style={[styles.caughtUpTitle, { color: colors.text }]}>Couldn’t load review</Text>
            <Text style={[styles.caughtUpBody, { color: colors.secondary }]}>{error}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void reload()}
              style={[styles.doneButton, { backgroundColor: colors.accent }]}
            >
              <Text style={[styles.doneButtonText, { color: '#FFFFFF' }]}>Try again</Text>
            </Pressable>
          </View>
        ) : viewState === 'complete' ? (
          <View style={styles.caughtUp} testID="review-complete">
            <SymbolView name="checkmark.circle.fill" size={58} tintColor={colors.positive} />
            <Text style={[styles.caughtUpTitle, { color: colors.text }]}>All caught up</Text>
            <Text style={[styles.caughtUpBody, { color: colors.secondary }]}>
              Everything in your financial inbox has been reviewed.
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              onPress={() => router.back()}
              style={[
                styles.doneButton,
                { backgroundColor: colors.accent, opacity: saving ? 0.5 : 1 },
              ]}
            >
              <Text style={[styles.doneButtonText, { color: '#FFFFFF' }]}>
                {saving ? 'Finishing…' : 'Done'}
              </Text>
            </Pressable>
          </View>
        ) : current ? (
          <Animated.View
            style={[
              styles.card,
              {
                opacity,
                transform: [
                  {
                    translateY: opacity.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }),
                  },
                ],
              },
            ]}
          >
            <ScrollView
              contentContainerStyle={styles.reviewContent}
              showsVerticalScrollIndicator={false}
            >
              <Text style={[styles.date, { color: colors.secondary }]}>
                {relativeDate(current.occurredAt, home?.currentDate)} · {current.account}
              </Text>
              <Text
                maxFontSizeMultiplier={1.6}
                numberOfLines={2}
                style={[styles.merchant, { color: colors.text }]}
              >
                {current.merchant}
              </Text>
              <Text
                adjustsFontSizeToFit
                allowFontScaling={false}
                minimumFontScale={0.7}
                numberOfLines={1}
                style={[
                  styles.amount,
                  { color: current.amount > 0 ? colors.positive : colors.text },
                ]}
              >
                {formatMoney(current.amount, current.currencyCode ?? home?.currencyCode, true)}
              </Text>
              {current.description ? (
                <Text style={[styles.description, { color: colors.secondary }]}>
                  {current.description}
                </Text>
              ) : null}

              <View style={[styles.fields, { backgroundColor: colors.surface }]}>
                <Field
                  symbol="tag"
                  label="Category"
                  value={current.category}
                  colors={colors}
                  disabled={saving}
                  onPress={() => setPicker('category')}
                  testID="review-category"
                />
                <Field
                  symbol="person"
                  label="Owner"
                  value={current.owner}
                  colors={colors}
                  disabled={saving}
                  onPress={() => setPicker('owner')}
                />
                <View style={styles.fieldRow}>
                  <SymbolView name="chart.bar" size={18} tintColor={colors.secondary} />
                  <View style={styles.fieldText}>
                    <Text style={[styles.fieldLabel, { color: colors.text }]}>
                      Include in reports
                    </Text>
                    <Text style={[styles.fieldValue, { color: colors.secondary }]}>
                      {current.included ? 'Included' : 'Excluded'}
                    </Text>
                  </View>
                  <Switch
                    disabled={saving}
                    value={current.included}
                    onValueChange={(included) => {
                      void saveField(current, { included });
                    }}
                    trackColor={{ true: colors.positive }}
                  />
                </View>
                <View style={styles.fieldRow}>
                  <SymbolView name="calendar" size={18} tintColor={colors.secondary} />
                  <View style={styles.fieldText}>
                    <Text style={[styles.fieldLabel, { color: colors.text }]}>Reporting date</Text>
                    <Text style={[styles.fieldValue, { color: colors.secondary }]}>
                      {current.effectiveDate}
                    </Text>
                  </View>
                </View>
              </View>
              {error || saveError ? (
                <Text style={[styles.error, { color: colors.danger }]}>{error ?? saveError}</Text>
              ) : null}
            </ScrollView>
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                disabled={saving}
                onPress={() => void complete({ reviewed: true })}
                testID="looks-right"
                style={({ pressed }) => [
                  styles.primaryButton,
                  {
                    backgroundColor: colors.accent,
                    opacity: saving ? 0.5 : pressed ? 0.76 : 1,
                  },
                ]}
              >
                <SymbolView name="checkmark" size={17} tintColor="#FFFFFF" />
                <Text style={[styles.primaryButtonText, { color: '#FFFFFF' }]}>
                  {saving ? 'Saving…' : 'Looks right'}
                </Text>
              </Pressable>
              <Text style={[styles.actionHint, { color: colors.secondary }]}>
                Changing the category confirms it automatically.
              </Text>
            </View>
          </Animated.View>
        ) : null}
      </View>
      <CategoryPickerSheet
        categories={options.categories}
        onClose={() => setPicker(null)}
        onSelect={(category) => {
          setPicker(null);
          if (current) void complete({ category, reviewed: true });
        }}
        selected={current?.category}
        visible={picker === 'category'}
      />
      <OptionSheet
        visible={picker === 'owner'}
        title="Choose owner"
        options={options.owners}
        selected={current?.owner}
        colors={colors}
        onClose={() => setPicker(null)}
        onSelect={(value) => {
          setPicker(null);
          if (current) void saveField(current, { owner: value });
        }}
      />
    </>
  );
}

function Field({
  symbol,
  label,
  value,
  colors,
  disabled,
  onPress,
  testID,
}: {
  symbol: Parameters<typeof SymbolView>[0]['name'];
  label: string;
  value: string;
  colors: AppColors;
  disabled: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={[styles.fieldRow, disabled && styles.disabled]}
    >
      <SymbolView name={symbol} size={18} tintColor={colors.secondary} />
      <View style={styles.fieldText}>
        <Text style={[styles.fieldLabel, { color: colors.text }]}>{label}</Text>
        <Text style={[styles.fieldValue, { color: colors.secondary }]}>{value}</Text>
      </View>
      <SymbolView name="chevron.up.chevron.down" size={12} tintColor={colors.tertiary} />
    </Pressable>
  );
}

function OptionSheet({
  visible,
  title,
  options,
  selected,
  colors,
  onClose,
  onSelect,
}: {
  visible: boolean;
  title: string;
  options: string[];
  selected?: string;
  colors: AppColors;
  onClose: () => void;
  onSelect: (value: string) => void;
}) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.sheet, { backgroundColor: colors.background }]}>
        <View style={styles.sheetHeader}>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.sheetButton}>
            <Text style={[styles.sheetButtonText, { color: colors.accent }]}>Cancel</Text>
          </Pressable>
          <Text style={[styles.sheetTitle, { color: colors.text }]}>{title}</Text>
          <View style={styles.sheetButton} />
        </View>
        <ScrollView contentContainerStyle={styles.sheetList}>
          {options.map((option) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: selected === option }}
              key={option}
              onPress={() => onSelect(option)}
              style={[styles.option, { borderBottomColor: colors.separator }]}
            >
              <Text style={[styles.optionText, { color: colors.text }]}>{option}</Text>
              {selected === option ? (
                <SymbolView name="checkmark" size={16} tintColor={colors.accent} />
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

function relativeDate(value: string, currentDate?: string) {
  const day = value.slice(0, 10);
  if (day === currentDate) return 'Today';
  const current = currentDate ? new Date(`${currentDate}T12:00:00Z`) : null;
  if (current) {
    current.setUTCDate(current.getUTCDate() - 1);
    if (day === current.toISOString().slice(0, 10)) return 'Yesterday';
  }
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(value));
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  progressText: { fontSize: 13, fontWeight: '600' },
  progressCount: { fontSize: 12, fontVariant: ['tabular-nums'] },
  progressTrack: {
    height: 3,
    marginHorizontal: 20,
    marginTop: 9,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 2 },
  card: { flex: 1 },
  reviewContent: { paddingHorizontal: 20, paddingTop: 34, paddingBottom: 24 },
  date: { fontSize: 13, textAlign: 'center', writingDirection: 'auto' },
  merchant: {
    marginTop: 16,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
    textAlign: 'center',
    writingDirection: 'ltr',
  },
  amount: {
    marginTop: 8,
    fontSize: 42,
    lineHeight: 49,
    fontWeight: '700',
    letterSpacing: -1.2,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  description: { marginTop: 8, fontSize: 14, textAlign: 'center', writingDirection: 'auto' },
  fields: { marginTop: 36, borderRadius: 16, paddingHorizontal: 14 },
  fieldRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 12 },
  disabled: { opacity: 0.55 },
  fieldText: { flex: 1 },
  fieldLabel: { fontSize: 15, fontWeight: '600' },
  fieldValue: { marginTop: 2, fontSize: 13, writingDirection: 'ltr' },
  error: { marginTop: 16, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  actions: { paddingHorizontal: 20, paddingTop: 10 },
  primaryButton: {
    minHeight: 54,
    borderRadius: 17,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryButtonText: { fontSize: 17, fontWeight: '700' },
  actionHint: { marginTop: 8, fontSize: 11.5, textAlign: 'center' },
  caughtUp: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36 },
  caughtUpTitle: { marginTop: 20, fontSize: 29, lineHeight: 35, fontWeight: '700' },
  caughtUpBody: { marginTop: 8, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  doneButton: {
    minHeight: 52,
    alignSelf: 'stretch',
    marginTop: 30,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneButtonText: { fontSize: 17, fontWeight: '700' },
  sheet: { flex: 1 },
  sheetHeader: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  sheetTitle: { fontSize: 17, fontWeight: '700' },
  sheetButton: { width: 72, minHeight: 44, justifyContent: 'center' },
  sheetButtonText: { fontSize: 16 },
  sheetList: { paddingHorizontal: 20, paddingBottom: 40 },
  option: {
    minHeight: 54,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionText: { fontSize: 17, writingDirection: 'ltr' },
});
