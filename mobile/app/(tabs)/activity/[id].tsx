import { t } from '@/localization';
import { categoryLabel, ownerLabel } from '@/translations';
import { DirectionalChevron } from '@/DirectionalChevron';
import { currentLocale } from '@/locale-state';
import { Text } from '@/LocalizedText';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { MobileRequestError } from '@/request-error';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { CategoryPickerSheet } from '@/CategoryPickerSheet';
import { ConnectionState } from '@/ConnectionState';
import { useMoneyData, useTransaction } from '@/MoneyData';
import { formatMoney } from '@/money';
import type { TransactionUpdate } from '@/mobile-api';
import { useAppColors } from '@/theme';

export default function TransactionDetailScreen() {
  const colors = useAppColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const money = useMoneyData();
  const result = useTransaction(id);
  const sourceTransaction = result.transaction;
  const [edits, setEdits] = useState<{
    id: string;
    resourceVersion?: number;
    category?: string;
    effectiveDate?: string;
    needsReview?: boolean;
  } | null>(null);
  const [saving, setSaving] = useState<'category' | 'effectiveDate' | 'reviewed' | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [categoryVisible, setCategoryVisible] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const scope = useRef(0);
  const operation = useRef<symbol | null>(null);
  const optionsRequest = useRef(0);
  useEffect(() => {
    scope.current++;
    operation.current = null;
    optionsRequest.current++;
    setSaving(null);
    setOptionsLoading(false);
    setCategoryVisible(false);
    setSaveError(null);
    return () => {
      scope.current++;
      operation.current = null;
      optionsRequest.current++;
    };
  }, [id]);
  const transaction =
    sourceTransaction && edits?.id === sourceTransaction.id
      ? { ...sourceTransaction, ...edits }
      : sourceTransaction;

  if (money.status !== 'ready' || !money.canMutate) return <ConnectionState />;

  if (result.loading && !transaction) {
    return (
      <View style={[styles.missing, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={[styles.missingBody, { color: colors.secondary }]}>
          {t('loadingTransactionFromYourMac')}
        </Text>
      </View>
    );
  }

  if (!transaction) {
    return (
      <View style={[styles.missing, { backgroundColor: colors.background }]}>
        <Text style={[styles.missingTitle, { color: colors.text }]}>
          {t('transactionUnavailable')}
        </Text>
        <Text style={[styles.missingBody, { color: colors.secondary }]}>
          {result.error ?? t('thisTransactionIsNoLongerAvailable')}
        </Text>
      </View>
    );
  }

  const date = new Intl.DateTimeFormat(currentLocale(), {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    ...(money.source === 'fixture' ? { hour: 'numeric', minute: '2-digit' } : {}),
  }).format(new Date(transaction.occurredAt));
  const transactionId = transaction.id;
  const resourceVersion = transaction.resourceVersion;
  const currentCategory = transaction.category;
  const currentEffectiveDate = transaction.effectiveDate;

  async function saveField(
    field: 'category' | 'effectiveDate',
    update: Pick<TransactionUpdate, 'category'> | Pick<TransactionUpdate, 'effectiveDate'>,
  ) {
    if (operation.current || !money.canMutate) return;
    const acceptedScope = scope.current;
    const token = Symbol();
    operation.current = token;
    const previous = edits;
    setEdits((value) => ({
      ...(value?.id === transactionId ? value : { id: transactionId }),
      ...update,
    }));
    setSaving(field);
    setSaveError(null);
    try {
      const accepted = await money.saveTransaction(transactionId, update, resourceVersion);
      if (scope.current !== acceptedScope) return;
      setEdits((value) => ({
        ...value,
        id: transactionId,
        resourceVersion: accepted.resourceVersion,
      }));
      void Haptics.selectionAsync().catch(() => {});
    } catch (cause) {
      if (scope.current !== acceptedScope) return;
      // A transport failure can follow acceptance; retain the draft for receipt replay.
      if (cause instanceof MobileRequestError && cause.current)
        setEdits({ ...cause.current, ...update });
      else if (
        cause instanceof MobileRequestError &&
        cause.kind === 'api' &&
        (cause.status ?? 500) < 500
      )
        setEdits(previous);
      setSaveError(t('thisTransactionCouldNotBeSaved'));
    } finally {
      if (operation.current === token) {
        operation.current = null;
        setSaving(null);
      }
    }
  }

  async function confirmReview() {
    if (operation.current || !money.canMutate) return;
    const acceptedScope = scope.current;
    const token = Symbol();
    operation.current = token;
    setSaving('reviewed');
    setSaveError(null);
    try {
      const accepted = await money.saveTransaction(
        transactionId,
        { reviewed: true },
        resourceVersion,
      );
      if (scope.current !== acceptedScope) return;
      setEdits((value) => ({
        ...(value?.id === transactionId ? value : { id: transactionId }),
        needsReview: false,
        resourceVersion: accepted.resourceVersion,
      }));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (cause) {
      if (scope.current === acceptedScope && cause instanceof MobileRequestError && cause.current)
        setEdits({ ...cause.current });
      if (scope.current === acceptedScope) setSaveError(t('thisTransactionCouldNotBeSaved'));
    } finally {
      if (operation.current === token) {
        operation.current = null;
        setSaving(null);
      }
    }
  }

  async function chooseCategory() {
    if (operation.current || optionsLoading || !money.canMutate) return;
    const request = ++optionsRequest.current;
    setOptionsLoading(true);
    setSaveError(null);
    try {
      const { categories } = await money.loadReviewOptions();
      if (request !== optionsRequest.current) return;
      setCategories(categories);
      setCategoryVisible(true);
    } catch {
      if (request === optionsRequest.current) setSaveError(t('categoriesCouldNotBeLoaded'));
    } finally {
      if (request === optionsRequest.current) setOptionsLoading(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: transaction.merchant }} />
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        testID="transaction-detail"
      >
        <View style={styles.hero}>
          <Text
            adjustsFontSizeToFit
            maxFontSizeMultiplier={1.4}
            minimumFontScale={0.7}
            numberOfLines={1}
            style={[
              styles.amount,
              { color: transaction.amount > 0 ? colors.positive : colors.text },
            ]}
          >
            {formatMoney(transaction.amount, transaction.currencyCode, true)}
          </Text>
          <Text maxFontSizeMultiplier={1.6} style={[styles.merchant, { color: colors.text }]}>
            {transaction.merchant}
          </Text>
          <View style={styles.flags}>
            {transaction.pending ? (
              <DetailFlag
                label={t('pending')}
                color={colors.warning}
                background={colors.warningSoft}
              />
            ) : null}
            {transaction.needsReview ? (
              <DetailFlag
                label={t('needsReview')}
                color={colors.accent}
                background={colors.accentSoft}
              />
            ) : null}
          </View>
        </View>

        {transaction.needsReview ? (
          <Pressable
            accessibilityRole="button"
            disabled={saving !== null || optionsLoading}
            onPress={() => void confirmReview()}
            style={({ pressed }) => [
              styles.confirm,
              {
                backgroundColor: colors.accent,
                opacity: saving !== null ? 0.5 : pressed ? 0.76 : 1,
              },
            ]}
            testID="transaction-looks-right"
          >
            <SymbolView name="checkmark" size={17} tintColor={colors.onAccent} />
            <Text style={[styles.confirmText, { color: colors.onAccent }]}>
              {saving === 'reviewed' ? t('saving') : t('looksRight')}
            </Text>
          </Pressable>
        ) : null}

        <View style={[styles.group, { backgroundColor: colors.surface }]}>
          <DetailRow
            label={t('category')}
            value={saving === 'category' ? t('saving') : categoryLabel(transaction.category)}
            disabled={saving !== null || optionsLoading}
            onPress={() => void chooseCategory()}
            testID="transaction-category"
          />
          <DatePickerRow
            disabled={saving !== null || optionsLoading}
            onChange={(value) => {
              const effectiveDate = financialDate(value);
              if (effectiveDate !== currentEffectiveDate) {
                void saveField('effectiveDate', { effectiveDate });
              }
            }}
            saving={saving === 'effectiveDate'}
            value={parseFinancialDate(currentEffectiveDate)}
          />
          <DetailRow label={t('owner')} value={ownerLabel(transaction.owner)} />
          <DetailRow
            label={t('reports')}
            value={transaction.included ? t('included') : t('excluded')}
            last
          />
        </View>

        <View style={[styles.group, styles.secondGroup, { backgroundColor: colors.surface }]}>
          <DetailRow label={t('date')} value={date} />
          <DetailRow
            label={t('account')}
            value={transaction.account}
            last={!transaction.description}
          />
          {transaction.description ? (
            <DetailRow label={t('description')} value={transaction.description} last />
          ) : null}
        </View>
        {saveError ? (
          <Text style={[styles.saveError, { color: colors.danger }]}>{saveError}</Text>
        ) : null}
      </ScrollView>
      <CategoryPickerSheet
        categories={categories}
        onClose={() => setCategoryVisible(false)}
        onSelect={(category) => {
          setCategoryVisible(false);
          if (category !== currentCategory) void saveField('category', { category });
        }}
        selected={currentCategory}
        title={t('changeCategory')}
        visible={categoryVisible}
      />
    </>
  );
}

function DatePickerRow({
  disabled,
  onChange,
  saving,
  value,
}: {
  disabled: boolean;
  onChange: (value: Date) => void;
  saving: boolean;
  value: Date;
}) {
  const colors = useAppColors();
  return (
    <View style={[styles.detailRow, disabled && styles.disabled]}>
      <View
        style={[
          styles.detailRowBody,
          styles.dateRowBody,
          { borderBottomColor: colors.separator, borderBottomWidth: StyleSheet.hairlineWidth },
        ]}
      >
        <Text
          adjustsFontSizeToFit
          maxFontSizeMultiplier={1.5}
          minimumFontScale={0.85}
          numberOfLines={1}
          style={[styles.detailLabel, styles.dateLabel, { color: colors.text }]}
        >
          {t('effectiveDate')}
        </Text>
        {saving ? (
          <Text style={[styles.dateSaving, { color: colors.secondary }]}>{t('saving')}</Text>
        ) : (
          <DateTimePicker
            locale={currentLocale()}
            accentColor={colors.accent}
            disabled={disabled}
            display="compact"
            mode="date"
            onValueChange={(_, nextValue) => onChange(nextValue)}
            testID="transaction-effective-date"
            value={value}
          />
        )}
      </View>
    </View>
  );
}

function DetailRow({
  label,
  value,
  last = false,
  disabled = false,
  onPress,
  testID,
}: {
  label: string;
  value: string;
  last?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  testID?: string;
}) {
  const colors = useAppColors();
  const content = (
    <>
      <View
        style={[
          styles.detailRowBody,
          !last && {
            borderBottomColor: colors.separator,
            borderBottomWidth: StyleSheet.hairlineWidth,
          },
        ]}
      >
        <Text maxFontSizeMultiplier={1.5} style={[styles.detailLabel, { color: colors.text }]}>
          {label}
        </Text>
        <Text
          maxFontSizeMultiplier={1.5}
          numberOfLines={2}
          style={[styles.detailValue, { color: colors.secondary }]}
        >
          {value}
        </Text>
        {onPress ? (
          <DirectionalChevron direction="forward" size={12} tintColor={colors.tertiary} />
        ) : null}
      </View>
    </>
  );
  return onPress ? (
    <Pressable
      accessibilityLabel={`${label}, ${value}`}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.detailRow, disabled && styles.disabled]}
      testID={testID}
    >
      {content}
    </Pressable>
  ) : (
    <View style={styles.detailRow}>{content}</View>
  );
}

function parseFinancialDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year!, month! - 1, day!, 12);
}

function financialDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function DetailFlag({
  label,
  color,
  background,
}: {
  label: string;
  color: string;
  background: string;
}) {
  return (
    <View style={[styles.flag, { backgroundColor: background }]}>
      <Text maxFontSizeMultiplier={1.35} style={[styles.flagText, { color }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  hero: { alignItems: 'center', paddingTop: 20, paddingBottom: 24, paddingHorizontal: 20 },
  amount: {
    fontSize: 39,
    lineHeight: 46,
    fontWeight: '700',
    letterSpacing: -1.2,
    fontVariant: ['tabular-nums'],
  },
  merchant: {
    marginTop: 10,
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '600',
    textAlign: 'center',
    writingDirection: 'ltr',
  },
  flags: { flexDirection: 'row', gap: 7, marginTop: 14 },
  flag: {
    minHeight: 27,
    borderRadius: 8,
    paddingHorizontal: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flagText: { fontSize: 12, fontWeight: '700' },
  confirm: {
    minHeight: 50,
    marginBottom: 20,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  confirmText: { fontSize: 17, fontWeight: '700' },
  group: { borderRadius: 16, overflow: 'hidden' },
  secondGroup: { marginTop: 20 },
  detailRow: { minHeight: 52, flexDirection: 'row', paddingStart: 16 },
  detailRowBody: {
    flex: 1,
    minHeight: 52,
    paddingEnd: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  detailLabel: { flexShrink: 0, maxWidth: '50%', fontSize: 15 },
  // Hugs its text at the row's trailing edge in both directions; Hebrew dates need RTL ordering.
  detailValue: { flexShrink: 1, marginStart: 'auto', fontSize: 15, textAlign: 'right' },
  dateRowBody: { gap: 8 },
  dateLabel: { flex: 1, maxWidth: '100%' },
  dateSaving: { flex: 1, fontSize: 15, textAlign: 'right' },
  disabled: { opacity: 0.55 },
  saveError: { marginTop: 12, paddingHorizontal: 16, fontSize: 13, lineHeight: 18 },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  missingTitle: { fontSize: 21, fontWeight: '700' },
  missingBody: { marginTop: 8, fontSize: 15, textAlign: 'center' },
});
