import DateTimePicker from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
  const [dateVisible, setDateVisible] = useState(false);
  const [draftDate, setDraftDate] = useState(new Date());
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
          Loading transaction from your Mac…
        </Text>
      </View>
    );
  }

  if (!transaction) {
    return (
      <View style={[styles.missing, { backgroundColor: colors.background }]}>
        <Text style={[styles.missingTitle, { color: colors.text }]}>Transaction unavailable</Text>
        <Text style={[styles.missingBody, { color: colors.secondary }]}>
          {result.error ?? 'This transaction is no longer available.'}
        </Text>
      </View>
    );
  }

  const date = new Intl.DateTimeFormat('en', {
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
      setSaveError(
        caught instanceof Error ? caught.message : 'This transaction could not be saved.',
      );
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
      setSaving(null);
      const options = ['Cancel', ...categories];
      ActionSheetIOS.showActionSheetWithOptions(
        { title: 'Change category', options, cancelButtonIndex: 0, tintColor: colors.accent },
        (index) => {
          const category = options[index];
          if (index > 0 && category && category !== currentCategory) {
            void saveField('category', { category });
          }
        },
      );
    } catch (caught) {
      setSaving(null);
      setSaveError(
        caught instanceof Error ? caught.message : 'Categories could not be loaded.',
      );
    }
  }

  function openDatePicker() {
    if (saving) return;
    setDraftDate(parseFinancialDate(currentEffectiveDate));
    setDateVisible(true);
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
            style={[styles.amount, { color: transaction.amount > 0 ? colors.accent : colors.text }]}
          >
            {formatMoney(transaction.amount, transaction.currencyCode, true)}
          </Text>
          <Text maxFontSizeMultiplier={1.6} style={[styles.merchant, { color: colors.text }]}>
            {transaction.merchant}
          </Text>
          <Text maxFontSizeMultiplier={1.5} style={[styles.description, { color: colors.secondary }]}>
            {transaction.description ?? date}
          </Text>
          <View style={styles.flags}>
            {transaction.pending ? (
              <DetailFlag label="Pending" color={colors.warning} background={colors.warningSoft} />
            ) : null}
            {transaction.needsReview ? (
              <DetailFlag
                label="Needs review"
                color={colors.danger}
                background={colors.dangerSoft}
              />
            ) : null}
          </View>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.secondary }]}>TRANSACTION</Text>
        <View style={[styles.group, { backgroundColor: colors.surface }]}>
          <DetailRow label="Date" value={date} />
          <DetailRow label="Account" value={transaction.account} />
          <DetailRow label="Description" value={transaction.description ?? '—'} last />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.secondary }]}>MONEY MONITOR</Text>
        <View style={[styles.group, { backgroundColor: colors.surface }]}>
          <DetailRow
            label="Category"
            value={saving === 'category' ? 'Saving…' : transaction.category}
            symbol="tag"
            disabled={saving !== null}
            onPress={() => void chooseCategory()}
            testID="transaction-category"
          />
          <DetailRow label="Owner" value={transaction.owner} symbol="person" />
          <DetailRow
            label="Included"
            value={transaction.included ? 'Included in reports' : 'Excluded'}
            symbol="checkmark.circle"
          />
          <DetailRow
            label="Effective date"
            value={
              saving === 'effectiveDate'
                ? 'Saving…'
                : formatFinancialDate(transaction.effectiveDate)
            }
            symbol="calendar"
            disabled={saving !== null}
            onPress={openDatePicker}
            testID="transaction-effective-date"
          />
          <DetailRow
            label="Review"
            value={transaction.needsReview ? 'Needs review' : 'Reviewed'}
            symbol="checkmark.seal"
            last
          />
        </View>
        {saveError ? (
          <Text style={[styles.saveError, { color: colors.danger }]}>{saveError}</Text>
        ) : null}
      </ScrollView>
      <Modal
        animationType="slide"
        onRequestClose={() => setDateVisible(false)}
        presentationStyle="pageSheet"
        visible={dateVisible}
      >
        <View
          style={[styles.dateSheet, { backgroundColor: colors.background }]}
          testID="effective-date-sheet"
        >
          <View style={styles.dateSheetHeader}>
            <Pressable onPress={() => setDateVisible(false)} style={styles.dateSheetButton}>
              <Text style={[styles.dateSheetButtonText, { color: colors.accent }]}>Cancel</Text>
            </Pressable>
            <Text style={[styles.dateSheetTitle, { color: colors.text }]}>Effective date</Text>
            <Pressable
              onPress={() => {
                setDateVisible(false);
                const effectiveDate = financialDate(draftDate);
                if (effectiveDate !== transaction.effectiveDate) {
                  void saveField('effectiveDate', { effectiveDate });
                }
              }}
              style={styles.dateSheetButton}
              testID="save-effective-date"
            >
              <Text style={[styles.dateSheetDone, { color: colors.accent }]}>Done</Text>
            </Pressable>
          </View>
          <DateTimePicker
            accentColor={colors.accent}
            display="inline"
            mode="date"
            onChange={(_, value) => {
              if (value) setDraftDate(value);
            }}
            value={draftDate}
          />
        </View>
      </Modal>
    </>
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
          <SymbolView name="chevron.right" size={12} tintColor={colors.tertiary} />
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

function formatFinancialDate(value: string): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parseFinancialDate(value));
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
  group: { borderRadius: 12, overflow: 'hidden' },
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
  disabled: { opacity: 0.55 },
  saveError: { marginTop: 12, paddingHorizontal: 16, fontSize: 13, lineHeight: 18 },
  dateSheet: { flex: 1 },
  dateSheetHeader: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  dateSheetButton: { width: 72, minHeight: 44, justifyContent: 'center' },
  dateSheetButtonText: { fontSize: 16 },
  dateSheetDone: { fontSize: 16, fontWeight: '600', textAlign: 'right' },
  dateSheetTitle: { fontSize: 17, fontWeight: '700' },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  missingTitle: { fontSize: 21, fontWeight: '700' },
  missingBody: { marginTop: 8, fontSize: 15, textAlign: 'center' },
});
