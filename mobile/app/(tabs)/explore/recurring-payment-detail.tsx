import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ConnectionState } from '@/ConnectionState';
import { currentLocale, t } from '@/localization';
import { Text } from '@/LocalizedText';
import { useMoneyData } from '@/MoneyData';
import { fetchRecurringPaymentDetail, type RecurringPaymentDetail } from '@/mobile-api';
import { formatMoney } from '@/money';
import { useAppColors } from '@/theme';

function money(amount: number, currencyCode: string) {
  return formatMoney(amount, currencyCode, true).replace(/^\+/, '');
}

function displayDate(value: string) {
  return new Intl.DateTimeFormat(currentLocale(), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}

export default function RecurringPaymentDetailScreen() {
  const colors = useAppColors();
  const { accountId, currencyCode, merchantKey } = useLocalSearchParams<{
    accountId: string;
    currencyCode: string;
    merchantKey: string;
  }>();
  const { credential, status } = useMoneyData();
  const [detail, setDetail] = useState<RecurringPaymentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (status !== 'ready') return;
    if (!credential || !accountId || !currencyCode || !merchantKey) {
      setError(true);
      setLoading(false);
      return;
    }
    let current = true;
    setLoading(true);
    setError(false);
    void fetchRecurringPaymentDetail(credential, {
      accountId,
      currencyCode,
      merchantKey,
    })
      .then((value) => {
        if (current) setDetail(value);
      })
      .catch(() => {
        if (current) setError(true);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [accountId, credential, currencyCode, merchantKey, retry, status]);

  if (status !== 'ready') return <ConnectionState />;

  const matched = detail?.transactions.filter((row) => row.inPattern) ?? [];
  const others = detail?.transactions.filter((row) => !row.inPattern) ?? [];
  const chargeRows = (rows: typeof matched) =>
    rows.map((row, index) => (
      <Pressable
        key={row.id}
        accessibilityRole="button"
        accessibilityHint={t('opensTransactionDetails')}
        onPress={() => router.push(`/transaction/${row.id}`)}
        style={[
          styles.charge,
          index > 0 && {
            borderTopColor: colors.separator,
            borderTopWidth: StyleSheet.hairlineWidth,
          },
        ]}
      >
        <View style={styles.chargeText}>
          <Text style={[styles.chargeName, { color: colors.text }]} numberOfLines={2}>
            {row.description}
          </Text>
          <Text style={[styles.chargeDate, { color: colors.secondary }]}>
            {displayDate(row.date)}
          </Text>
        </View>
        <Text style={[styles.chargeAmount, { color: colors.text }]} allowFontScaling={false}>
          {money(row.amount, detail!.payment.currencyCode)}
        </Text>
      </Pressable>
    ));

  return (
    <>
      <Stack.Screen options={{ title: detail?.payment.name ?? t('subscriptionDetails') }} />
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        testID="recurring-payment-detail"
      >
        {loading ? (
          <ActivityIndicator style={styles.feedback} color={colors.accent} />
        ) : error || !detail ? (
          <View style={styles.feedback}>
            <Text style={[styles.note, { color: colors.secondary }]}>
              {t('recurringDetailError')}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => setRetry((value) => value + 1)}>
              <Text style={[styles.link, { color: colors.accent }]}>{t('tryAgain')}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={[styles.merchant, { color: colors.text }]}>{detail.payment.name}</Text>
            <Text style={[styles.note, { color: colors.secondary }]}>
              {detail.payment.accountName} ·{' '}
              {t(detail.payment.frequency === 'monthly' ? 'monthly' : 'everyTwoMonths')}
            </Text>
            <View style={[styles.summary, { backgroundColor: colors.surface }]}>
              <View style={styles.summaryColumn}>
                <Text style={[styles.label, { color: colors.secondary }]}>
                  {t('recurringUsualCharge')}
                </Text>
                <Text style={[styles.value, { color: colors.text }]} allowFontScaling={false}>
                  {money(detail.payment.usualAmount, detail.payment.currencyCode)}
                </Text>
              </View>
              <View style={styles.summaryColumn}>
                <Text style={[styles.label, { color: colors.secondary }]}>
                  {t('recurringYearCost')}
                </Text>
                <Text style={[styles.value, { color: colors.text }]} allowFontScaling={false}>
                  {money(detail.payment.annualCost, detail.payment.currencyCode)}
                </Text>
              </View>
            </View>
            {detail.previousAmount !== null && detail.changedOnDate && (
              <Text style={[styles.note, { color: colors.secondary }]}>
                {t('recurringPriceChange', {
                  previous: money(detail.previousAmount, detail.payment.currencyCode),
                  current: money(detail.payment.usualAmount, detail.payment.currencyCode),
                  date: displayDate(detail.changedOnDate),
                })}
              </Text>
            )}
            <Text style={[styles.note, { color: colors.secondary }]}>
              {t('recurringNextEstimate', { date: displayDate(detail.payment.nextExpectedDate) })}
            </Text>
            <Text style={[styles.heading, { color: colors.text }]}>
              {t('recurringPatternCharges')}
            </Text>
            <View style={[styles.list, { backgroundColor: colors.surface }]}>
              {chargeRows(matched)}
            </View>
            {others.length > 0 && (
              <>
                <Pressable accessibilityRole="button" onPress={() => setShowOthers(!showOthers)}>
                  <Text style={[styles.otherHeading, { color: colors.accent }]}>
                    {t('recurringOtherCharges', { count: others.length })} {showOthers ? '−' : '+'}
                  </Text>
                </Pressable>
                {showOthers && (
                  <View style={[styles.list, { backgroundColor: colors.surface }]}>
                    {chargeRows(others)}
                  </View>
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  feedback: { paddingTop: 60, alignItems: 'center', gap: 14 },
  merchant: { fontSize: 24, fontWeight: '700', marginTop: 8 },
  note: { fontSize: 13, lineHeight: 20, marginTop: 8 },
  link: { fontSize: 14, fontWeight: '600', padding: 10 },
  summary: { flexDirection: 'row', borderRadius: 16, padding: 18, marginTop: 22, gap: 20 },
  summaryColumn: { flex: 1 },
  label: { fontSize: 12 },
  value: { fontSize: 20, fontWeight: '700', marginTop: 5, fontVariant: ['tabular-nums'] },
  heading: { fontSize: 18, fontWeight: '700', marginTop: 28, marginBottom: 12 },
  otherHeading: { fontSize: 15, fontWeight: '600', marginTop: 26, marginBottom: 12 },
  list: { borderRadius: 16, overflow: 'hidden' },
  charge: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, padding: 16 },
  chargeText: { flex: 1 },
  chargeName: { fontSize: 14, fontWeight: '600' },
  chargeDate: { fontSize: 12, marginTop: 4 },
  chargeAmount: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
