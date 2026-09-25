import { t } from '@/localization';
import { ownerLabel } from '@/translations';
import { DirectionalChevron } from '@/DirectionalChevron';
import { currentLocale } from '@/locale-state';
import { Text } from '@/LocalizedText';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
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
    category?: string;
    effectiveDate?: string;
  } | null>(null);
  const [saving, setSaving] = useState<'category' | 'effectiveDate' | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [categoryVisible, setCategoryVisible] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const transaction =
    sourceTransaction && edits?.id === sourceTransaction.id
      ? { ...sourceTransaction, ...edits }
      : sourceTransaction;

  if (money.status !== 'ready') return <ConnectionState />;

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
  const currentCategory = transaction.category;
  const currentEffectiveDate = transaction.effectiveDate;

  async function saveField(
    field: 'category' | 'effectiveDate',
    update: Pick<TransactionUpdate, 'category'> | Pick<TransactionUpdate, 'effectiveDate'>,
  ) {
    if (saving) return;
    const previous = edits;
    setEdits((value) => ({
      ...(value?.id === transactionId ? value : { id: transactionId }),
      ...update,
    }));
    setSaving(field);
    setSaveError(null);
    try {
      await money.saveTransaction(transactionId, update);
      await Haptics.selectionAsync();
    } catch (caught) {
      setEdits(previous);
      setSaveError(caught instanceof Error ? caught.message : t('thisTransactionCouldNotBeSaved'));
    } finally {
      setSaving(null);
    }
  }

  async function chooseCategory() {
    if (saving) return;
    setSaving('category');
    setSaveError(null);
    try {
      const { categories } = await money.loadReviewOptions();
      setCategories(categories);
      setSaving(null);
      setCategoryVisible(true);
    } catch (caught) {
      setSaving(null);
      setSaveError(caught instanceof Error ? caught.message : t('categoriesCouldNotBeLoaded'));
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
            allowFontScaling={false}
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
          <Text
            maxFontSizeMultiplier={1.5}
            style={[styles.description, { color: colors.secondary }]}
          >
            {transaction.description ?? date}
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
                color={colors.danger}
                background={colors.dangerSoft}
              />
            ) : null}
          </View>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.secondary }]}>{t('tRANSACTION')}</Text>
        <View style={[styles.group, { backgroundColor: colors.surface }]}>
          <DetailRow label={t('date')} value={date} />
          <DetailRow label={t('account')} value={transaction.account} />
          <DetailRow label={t('description')} value={transaction.description ?? '—'} last />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.secondary }]}>{t('mONEYMONITOR')}</Text>
        <View style={[styles.group, { backgroundColor: colors.surface }]}>
          <DetailRow
            label={t('category')}
            value={saving === 'category' ? 'Saving…' : transaction.category}
            symbol="tag"
            disabled={saving !== null}
            onPress={() => void chooseCategory()}
            testID="transaction-category"
          />
          <DetailRow label={t('owner')} value={ownerLabel(transaction.owner)} symbol="person" />
          <DetailRow
            label={t('included')}
            value={transaction.included ? t('includedInReports') : t('excluded')}
            symbol="checkmark.circle"
          />
          <DatePickerRow
            disabled={saving !== null}
            onChange={(value) => {
              const effectiveDate = financialDate(value);
              if (effectiveDate !== currentEffectiveDate) {
                void saveField('effectiveDate', { effectiveDate });
              }
            }}
            saving={saving === 'effectiveDate'}
            value={parseFinancialDate(currentEffectiveDate)}
          />
          <DetailRow
            label={t('review')}
            value={transaction.needsReview ? t('needsReview') : t('reviewed')}
            symbol="checkmark.seal"
            last
          />
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
      <SymbolView name="calendar" size={17} tintColor={colors.secondary} style={styles.rowIcon} />
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
            onChange={(_, nextValue) => {
              if (nextValue) onChange(nextValue);
            }}
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
  symbol,
  last = false,
  disabled = false,
  onPress,
  testID,
}: {
  label: string;
  value: string;
  symbol?: Parameters<typeof SymbolView>[0]['name'];
  last?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  testID?: string;
}) {
  const colors = useAppColors();
  const content = (
    <>
      {symbol ? (
        <SymbolView name={symbol} size={17} tintColor={colors.secondary} style={styles.rowIcon} />
      ) : null}
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
  hero: { alignItems: 'center', paddingTop: 26, paddingBottom: 34, paddingHorizontal: 20 },
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
  description: { marginTop: 4, fontSize: 14, textAlign: 'center', writingDirection: 'auto' },
  flags: { flexDirection: 'row', gap: 7, marginTop: 14 },
  flag: {
    minHeight: 27,
    borderRadius: 8,
    paddingHorizontal: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flagText: { fontSize: 12, fontWeight: '700' },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 16,
    marginBottom: 7,
    marginTop: 23,
    letterSpacing: 0.25,
  },
  group: { borderRadius: 16, overflow: 'hidden' },
  detailRow: { minHeight: 52, flexDirection: 'row', paddingLeft: 16 },
  rowIcon: { width: 22, marginRight: 8, alignSelf: 'center' },
  detailRowBody: {
    flex: 1,
    minHeight: 52,
    paddingRight: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  detailLabel: { flex: 0.42, fontSize: 15 },
  detailValue: { flex: 0.58, fontSize: 15, textAlign: 'right', writingDirection: 'ltr' },
  dateRowBody: { gap: 8 },
  dateLabel: { flex: 1 },
  dateSaving: { flex: 1, fontSize: 15, textAlign: 'right' },
  disabled: { opacity: 0.55 },
  saveError: { marginTop: 12, paddingHorizontal: 16, fontSize: 13, lineHeight: 18 },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  missingTitle: { fontSize: 21, fontWeight: '700' },
  missingBody: { marginTop: 8, fontSize: 15, textAlign: 'center' },
});
