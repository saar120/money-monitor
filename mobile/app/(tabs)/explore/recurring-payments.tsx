import { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ConnectionState } from '@/ConnectionState';
import { currentLocale, t } from '@/localization';
import { Text } from '@/LocalizedText';
import { useMoneyData } from '@/MoneyData';
import {
  fetchRecurringPayments,
  saveRecurringPaymentDecision,
  type RecurringPayment,
  type RecurringPayments,
} from '@/mobile-api';
import { formatMoney } from '@/money';
import { useAppColors } from '@/theme';

function shortDate(value: string) {
  return new Intl.DateTimeFormat(currentLocale(), {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}

function exactMoney(value: number, currencyCode: string) {
  return formatMoney(value, currencyCode, true).replace(/^\+/, '');
}

function frequencyLabel(value: 'monthly' | 'everyTwoMonths') {
  return t(value === 'monthly' ? 'monthly' : 'everyTwoMonths');
}

export default function RecurringPaymentsScreen() {
  const colors = useAppColors();
  const { credential, home, revision, source, status } = useMoneyData();
  const [result, setResult] = useState<RecurringPayments | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const requestVersion = useRef(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (status !== 'ready' || !home) return;
    if (source === 'fixture') {
      // The demo has only one service charge, so it cannot establish a pattern.
      setResult({
        asOfDate: home.currentDate,
        payments: [],
        suggestions: [],
        excluded: [],
        totals: [],
        classificationPending: false,
      });
      setLoading(false);
      return;
    }
    if (!credential) return;
    let current = true;
    const version = ++requestVersion.current;
    const scheduleRefresh = (value: RecurringPayments) => {
      if (!value.classificationPending) return;
      refreshTimer.current = setTimeout(() => {
        void fetchRecurringPayments(credential)
          .then((refreshed) => {
            if (!current || version !== requestVersion.current) return;
            setResult(refreshed);
            scheduleRefresh(refreshed);
          })
          .catch(() => {});
      }, 5_000);
    };
    setLoading(true);
    setError(false);
    void fetchRecurringPayments(credential)
      .then((value) => {
        if (!current || version !== requestVersion.current) return;
        setResult(value);
        scheduleRefresh(value);
      })
      .catch(() => {
        if (current && version === requestVersion.current) setError(true);
      })
      .finally(() => {
        if (current && version === requestVersion.current) setLoading(false);
      });
    return () => {
      current = false;
      requestVersion.current++;
      clearTimeout(refreshTimer.current);
    };
  }, [attempt, credential, home, revision, source, status]);

  if (status !== 'ready' || !home) return <ConnectionState />;

  async function decide(payment: RecurringPayment, decision: 'include' | 'exclude' | 'auto') {
    if (!credential) return;
    requestVersion.current++;
    clearTimeout(refreshTimer.current);
    setSaving(true);
    setSaveError(false);
    try {
      const saved = await saveRecurringPaymentDecision(credential, payment, decision);
      setResult(saved);
      if (saved.classificationPending) setAttempt((value) => value + 1);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
      setLoading(false);
    }
  }

  function row(
    payment: RecurringPayment,
    index: number,
    section: 'payments' | 'suggestions' | 'excluded',
  ) {
    return (
      <View
        key={`${payment.accountId}-${payment.currencyCode}-${payment.merchantKey}`}
        style={[
          styles.row,
          index > 0 && {
            borderTopColor: colors.separator,
            borderTopWidth: StyleSheet.hairlineWidth,
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityHint={t('recurringOpenDetails')}
          onPress={() =>
            router.push({
              pathname: '/(tabs)/explore/recurring-payment-detail',
              params: {
                accountId: String(payment.accountId),
                currencyCode: payment.currencyCode,
                merchantKey: payment.merchantKey,
              },
            })
          }
        >
          <View style={styles.rowTop}>
            <Text style={[styles.name, { color: colors.text }]} numberOfLines={2}>
              {payment.name}
            </Text>
            <Text style={[styles.amount, { color: colors.text }]} allowFontScaling={false}>
              {exactMoney(payment.usualAmount, payment.currencyCode)}
            </Text>
          </View>
          <Text style={[styles.detail, { color: colors.secondary }]} numberOfLines={1}>
            {payment.accountName} · {frequencyLabel(payment.frequency)} ·{' '}
            {t('recurringChargeCount', { count: payment.occurrences })}
          </Text>
          {section !== 'excluded' && (
            <Text style={[styles.date, { color: colors.secondary }]}>
              {t('lastAndNextCharge', {
                last: shortDate(payment.lastChargeDate),
                next: shortDate(payment.nextExpectedDate),
              })}
            </Text>
          )}
        </Pressable>
        <View style={styles.actions}>
          {section === 'suggestions' && (
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              onPress={() => void decide(payment, 'include')}
            >
              <Text style={[styles.action, { color: colors.accent }]}>{t('recurringInclude')}</Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            onPress={() => void decide(payment, section === 'excluded' ? 'auto' : 'exclude')}
          >
            <Text style={[styles.action, { color: colors.secondary }]}>
              {t(
                section === 'excluded'
                  ? 'recurringUndo'
                  : section === 'suggestions'
                    ? 'recurringNotRecurring'
                    : 'recurringExclude',
              )}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      testID="recurring-payments-screen"
    >
      <Text style={[styles.intro, { color: colors.secondary }]}>{t('recurringIntro')}</Text>
      {saveError && (
        <Text accessibilityRole="alert" style={[styles.feedbackText, { color: colors.text }]}>
          {t('recurringSaveError')}
        </Text>
      )}
      {loading ? (
        <ActivityIndicator style={styles.feedback} color={colors.accent} />
      ) : error ? (
        <View style={styles.feedback}>
          <Text style={[styles.feedbackText, { color: colors.secondary }]}>
            {t('recurringLoadError')}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => setAttempt((value) => value + 1)}>
            <Text style={[styles.retry, { color: colors.accent }]}>{t('tryAgain')}</Text>
          </Pressable>
        </View>
      ) : result ? (
        <>
          {result.totals.map((total) => (
            <View key={total.currencyCode} style={styles.summary}>
              <Text style={[styles.summaryLabel, { color: colors.secondary }]}>
                {t('recurringMonthlyEstimate', { currency: total.currencyCode })}
              </Text>
              <Text style={[styles.summaryValue, { color: colors.text }]} allowFontScaling={false}>
                {exactMoney(total.monthlyCost, total.currencyCode)}
              </Text>
              <Text style={[styles.summaryAnnual, { color: colors.secondary }]}>
                {t('recurringAnnualEstimate', {
                  amount: exactMoney(total.annualCost, total.currencyCode),
                })}
              </Text>
            </View>
          ))}
          {result.payments.length ? (
            <>
              <Text style={[styles.heading, { color: colors.text }]}>{t('detectedPayments')}</Text>
              <View style={[styles.list, { backgroundColor: colors.surface }]}>
                {result.payments.map((payment, index) => row(payment, index, 'payments'))}
              </View>
            </>
          ) : !result.suggestions.length ? (
            <View style={styles.feedback}>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                {t('noSubscriptionsFound')}
              </Text>
              <Text style={[styles.feedbackText, { color: colors.secondary }]}>
                {t('recurringNeedsTwoCharges')}
              </Text>
            </View>
          ) : null}
          {!!result.suggestions.length && (
            <>
              <Text style={[styles.heading, { color: colors.text }]}>
                {t('recurringReviewHeading')}
              </Text>
              <Text style={[styles.sectionIntro, { color: colors.secondary }]}>
                {t('recurringReviewIntro')}
              </Text>
              <View style={[styles.list, { backgroundColor: colors.surface }]}>
                {result.suggestions.map((payment, index) => row(payment, index, 'suggestions'))}
              </View>
            </>
          )}
          {!!result.excluded.length && (
            <>
              <Text style={[styles.heading, { color: colors.text }]}>{t('recurringExcluded')}</Text>
              <View style={[styles.list, { backgroundColor: colors.surface }]}>
                {result.excluded.map((payment, index) => row(payment, index, 'excluded'))}
              </View>
            </>
          )}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  intro: { fontSize: 13, lineHeight: 19, marginTop: 4, marginBottom: 22 },
  summary: { marginBottom: 20 },
  summaryLabel: { fontSize: 13, fontWeight: '500' },
  summaryValue: {
    fontSize: 36,
    fontWeight: '700',
    letterSpacing: -1.1,
    marginTop: 3,
    fontVariant: ['tabular-nums'],
  },
  summaryAnnual: { fontSize: 13, marginTop: 3 },
  heading: { fontSize: 18, fontWeight: '700', marginTop: 12, marginBottom: 12 },
  sectionIntro: { fontSize: 13, lineHeight: 19, marginBottom: 12 },
  list: { borderRadius: 16, overflow: 'hidden' },
  row: { paddingHorizontal: 16, paddingVertical: 15, minHeight: 92 },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  name: { fontSize: 16, fontWeight: '600', flex: 1 },
  amount: { fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  detail: { fontSize: 13, marginTop: 4 },
  date: { fontSize: 12, marginTop: 5 },
  actions: { flexDirection: 'row', gap: 20, marginTop: 12 },
  action: { fontSize: 13, fontWeight: '600', paddingVertical: 6 },
  feedback: { paddingTop: 55, alignItems: 'center', gap: 10 },
  feedbackText: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  emptyTitle: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  retry: { fontSize: 14, fontWeight: '600', padding: 12 },
});
