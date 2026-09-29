import { currentLocale } from '@/locale-state';
import { Text } from '@/LocalizedText';
import { t, useLanguage } from '@/localization';
import { categoryLabel, ownerLabel } from '@/translations';
import * as Haptics from 'expo-haptics';
import { Stack, router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  useWindowDimensions,
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
  const { width } = useWindowDimensions();
  const { language } = useLanguage();
  const reduceMotion = useReducedMotion();
  const { home, reload, saveTransaction, loadReviewOptions } = useMoneyData();
  const { transactions, loading, error } = useActivityTransactions('', 'review');
  const [dismissedIds, setDismissedIds] = useState(() => new Set<string>());
  const [overrides, setOverrides] = useState<
    Record<string, Partial<Pick<Transaction, 'included' | 'owner'>>>
  >({});
  const queue = transactions.filter((transaction) => !dismissedIds.has(transaction.id));
  // Keep the saved card on screen while the provider refreshes the queue.
  const [heldCard, setHeldCard] = useState<Transaction | null>(null);
  const sourceCurrent = heldCard ?? queue[0] ?? null;
  const current = sourceCurrent ? { ...sourceCurrent, ...overrides[sourceCurrent.id] } : null;
  const [sessionTotal, setSessionTotal] = useState(home?.reviewCount ?? 0);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<'category' | 'owner' | null>(null);
  const [options, setOptions] = useState({ categories: [] as string[], owners: [] as string[] });
  const [saveError, setSaveError] = useState<string | null>(null);
  const departure = useRef(new Animated.Value(0)).current;
  const arrival = useRef(new Animated.Value(1)).current;
  const burst = useRef(new Animated.Value(1)).current;
  const busy = useRef(false);
  const mounted = useRef(true);
  const completionScale = useRef(new Animated.Value(1)).current;
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
        setSaveError(caught instanceof Error ? caught.message : t('reviewOptionsCouldNotBeLoaded')),
      );
  }, [loadReviewOptions]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      departure.stopAnimation();
      arrival.stopAnimation();
    };
  }, [arrival, departure]);

  async function complete(update: TransactionUpdate) {
    if (!current || busy.current || saving) return;
    busy.current = true;
    setHeldCard(current);
    setSaving(true);
    setSaveError(null);
    try {
      await saveTransaction(current.id, update);
      if (!mounted.current) return;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (!reduceMotion) {
        await new Promise<void>((resolve) =>
          Animated.timing(departure, {
            toValue: 1,
            duration: 300,
            easing: Easing.bezier(0.4, 0, 0.8, 0.6),
            useNativeDriver: true,
          }).start(() => resolve()),
        );
      }
      if (!mounted.current) return;
      departure.setValue(0);
      arrival.setValue(reduceMotion ? 1 : 0);
      setDismissedIds((ids) => new Set(ids).add(current.id));
      setHeldCard(null);
      if (!reduceMotion) {
        Animated.spring(arrival, {
          toValue: 1,
          damping: 19,
          stiffness: 230,
          mass: 0.9,
          useNativeDriver: true,
        }).start();
      }
    } catch (caught) {
      if (!mounted.current) return;
      departure.setValue(0);
      setSaveError(caught instanceof Error ? caught.message : t('thisTransactionCouldNotBeSaved'));
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
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
      setSaveError(caught instanceof Error ? caught.message : t('thisTransactionCouldNotBeSaved'));
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

  useEffect(() => {
    if (viewState !== 'complete' || !reviewed || reduceMotion) {
      completionScale.setValue(1);
      burst.setValue(1);
      return;
    }
    completionScale.setValue(0.45);
    burst.setValue(0);
    const animation = Animated.spring(completionScale, {
      toValue: 1,
      stiffness: 260,
      damping: 20,
      mass: 0.7,
      useNativeDriver: true,
    });
    const celebration = Animated.parallel([
      animation,
      Animated.timing(burst, {
        toValue: 1,
        duration: 650,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);
    celebration.start();
    return () => celebration.stop();
  }, [burst, completionScale, reduceMotion, reviewed, viewState]);

  return (
    <>
      <Stack.Screen options={{ title: t('review'), headerBackTitle: t('back') }} />
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
              ? t('savingChanges')
              : remaining
                ? t('transactionsToReview', { count: remaining })
                : t('inboxZero')}
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
            <Text style={{ color: colors.secondary }}>{t('loadingReviewQueue')}</Text>
          </View>
        ) : viewState === 'error' ? (
          <View style={styles.caughtUp} testID="review-error">
            <SymbolView name="exclamationmark.triangle.fill" size={44} tintColor={colors.warning} />
            <Text style={[styles.caughtUpTitle, { color: colors.text }]}>
              {t('couldnTLoadReview')}
            </Text>
            <Text style={[styles.caughtUpBody, { color: colors.secondary }]}>{error}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void reload()}
              style={[styles.doneButton, { backgroundColor: colors.accent }]}
            >
              <Text style={[styles.doneButtonText, { color: '#FFFFFF' }]}>{t('tryAgain')}</Text>
            </Pressable>
          </View>
        ) : viewState === 'complete' ? (
          <View style={styles.caughtUp} testID="review-complete">
            <View style={styles.completionSeal}>
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.completionRing,
                  {
                    borderColor: colors.positive,
                    opacity: burst.interpolate({
                      inputRange: [0, 0.12, 1],
                      outputRange: [0, 0.8, 0],
                    }),
                    transform: [
                      {
                        scale: burst.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.65] }),
                      },
                    ],
                  },
                ]}
              />
              {Array.from({ length: 8 }, (_, index) => {
                const angle = (index * Math.PI) / 4;
                return (
                  <Animated.View
                    key={index}
                    pointerEvents="none"
                    style={[
                      styles.completionRay,
                      {
                        backgroundColor: index % 2 ? colors.accent : colors.positive,
                        opacity: burst.interpolate({
                          inputRange: [0, 0.15, 0.75, 1],
                          outputRange: [0, 1, 1, 0],
                        }),
                        transform: [
                          {
                            translateX: burst.interpolate({
                              inputRange: [0, 1],
                              outputRange: [35 * Math.sin(angle), 90 * Math.sin(angle)],
                            }),
                          },
                          {
                            translateY: burst.interpolate({
                              inputRange: [0, 1],
                              outputRange: [35 * Math.cos(angle), 90 * Math.cos(angle)],
                            }),
                          },
                          { rotate: `${-index * 45}deg` },
                          {
                            scaleY: burst.interpolate({
                              inputRange: [0, 0.3, 1],
                              outputRange: [0.2, 1, 0.1],
                            }),
                          },
                        ],
                      },
                    ]}
                  />
                );
              })}
              <Animated.View style={{ transform: [{ scale: completionScale }] }}>
                <SymbolView name="checkmark.circle.fill" size={96} tintColor={colors.positive} />
              </Animated.View>
            </View>
            <Text style={[styles.caughtUpTitle, { color: colors.text }]}>{t('allCaughtUp')}</Text>
            <Text style={[styles.caughtUpBody, { color: colors.secondary }]}>
              {t('everythingInYourFinancialInboxHasBeenReviewed')}
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
                {saving ? t('finishing') : t('done')}
              </Text>
            </Pressable>
          </View>
        ) : current ? (
          <>
            <View style={styles.cardStack}>
              {[2, 1]
                .filter((depth) => queue.filter((item) => item.id !== current.id).length >= depth)
                .map((depth) => (
                  <Animated.View
                    key={depth}
                    pointerEvents="none"
                    accessibilityElementsHidden
                    style={[
                      styles.queuedCard,
                      {
                        backgroundColor: depth === 1 ? colors.surfaceSoft : colors.accentSoft,
                        borderColor: colors.separator,
                        transform: [{ translateY: -depth * 10 }, { scale: 1 - depth * 0.045 }],
                      },
                    ]}
                  />
                ))}
              <Animated.View
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.separator,
                    opacity: departure.interpolate({
                      inputRange: [0, 0.7, 1],
                      outputRange: [1, 1, 0],
                    }),
                    transform: [
                      {
                        translateX: departure.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, width * (language === 'he' ? -1.2 : 1.2)],
                        }),
                      },
                      {
                        translateY: arrival.interpolate({
                          inputRange: [0, 1],
                          outputRange: [-22, 0],
                        }),
                      },
                      {
                        scale: arrival.interpolate({ inputRange: [0, 1], outputRange: [0.91, 1] }),
                      },
                      {
                        rotate: departure.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['0deg', language === 'he' ? '-14deg' : '14deg'],
                        }),
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

                  <View style={[styles.fields, { backgroundColor: colors.surfaceSoft }]}>
                    <Field
                      symbol="tag"
                      label={t('category')}
                      value={categoryLabel(current.category)}
                      colors={colors}
                      disabled={saving}
                      onPress={() => setPicker('category')}
                      testID="review-category"
                    />
                    <Field
                      symbol="person"
                      label={t('owner')}
                      value={ownerLabel(current.owner)}
                      colors={colors}
                      disabled={saving}
                      onPress={() => setPicker('owner')}
                    />
                    <View style={styles.fieldRow}>
                      <SymbolView name="chart.bar" size={18} tintColor={colors.secondary} />
                      <View style={styles.fieldText}>
                        <Text style={[styles.fieldLabel, { color: colors.text }]}>
                          {t('includeInReports')}
                        </Text>
                        <Text style={[styles.fieldValue, { color: colors.secondary }]}>
                          {current.included ? t('included') : t('excluded')}
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
                        <Text style={[styles.fieldLabel, { color: colors.text }]}>
                          {t('reportingDate')}
                        </Text>
                        <Text style={[styles.fieldValue, { color: colors.secondary }]}>
                          {current.effectiveDate}
                        </Text>
                      </View>
                    </View>
                  </View>
                  {error || saveError ? (
                    <Text style={[styles.error, { color: colors.danger }]}>
                      {error ?? saveError}
                    </Text>
                  ) : null}
                </ScrollView>
              </Animated.View>
            </View>
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
                  {saving ? t('saving') : t('looksRight')}
                </Text>
              </Pressable>
              <Text style={[styles.actionHint, { color: colors.secondary }]}>
                {t('changingTheCategoryConfirmsItAutomatically')}
              </Text>
            </View>
          </>
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
        title={t('chooseOwner')}
        options={options.owners.map((value) => ({ value, label: ownerLabel(value) }))}
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
  options: { value: string; label: string }[];
  selected?: string;
  colors: AppColors;
  onClose: () => void;
  onSelect: (value: string) => void;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <Modal
      visible={visible}
      animationType={reduceMotion ? 'none' : 'slide'}
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.sheet, { backgroundColor: colors.background }]}>
        <View style={styles.sheetHeader}>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.sheetButton}>
            <Text style={[styles.sheetButtonText, { color: colors.accent }]}>{t('cancel')}</Text>
          </Pressable>
          <Text style={[styles.sheetTitle, { color: colors.text }]}>{title}</Text>
          <View style={styles.sheetButton} />
        </View>
        <ScrollView contentContainerStyle={styles.sheetList}>
          {options.map((option) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: selected === option.value }}
              key={option.value}
              onPress={() => onSelect(option.value)}
              style={[styles.option, { borderBottomColor: colors.separator }]}
            >
              <Text style={[styles.optionText, { color: colors.text }]}>{option.label}</Text>
              {selected === option.value ? (
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
    if (day === current.toISOString().slice(0, 10)) return t('yesterday');
  }
  return new Intl.DateTimeFormat(currentLocale(), { month: 'short', day: 'numeric' }).format(
    new Date(value),
  );
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
  cardStack: { flex: 1, marginHorizontal: 16, marginTop: 32, marginBottom: 10 },
  queuedCard: {
    ...StyleSheet.absoluteFill,
    borderRadius: 26,
    borderWidth: 1,
    transformOrigin: 'top',
  },
  card: { flex: 1, borderRadius: 26, borderWidth: 1, overflow: 'hidden' },
  completionSeal: { width: 128, height: 128, alignItems: 'center', justifyContent: 'center' },
  completionRing: {
    position: 'absolute',
    width: 108,
    height: 108,
    borderRadius: 54,
    borderWidth: 2,
  },
  completionRay: { position: 'absolute', width: 4, height: 14, borderRadius: 2 },
  reviewContent: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 24 },
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
  fields: { marginTop: 24, borderRadius: 16, paddingHorizontal: 14 },
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
