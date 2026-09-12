import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ActivityCriteria } from './MoneyData';
import { useAppColors, type AppColors } from './theme';

type AccountOption = { id?: string; label: string };

export function activityFilterCount(value: ActivityCriteria) {
  return [
    value.startDate || value.endDate,
    value.category,
    value.account,
    value.owner,
    value.status,
    value.direction,
    value.needsReview,
    value.inclusion && value.inclusion !== 'all',
  ].filter(Boolean).length;
}

function validDate(value: string | undefined) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function ActivityFiltersSheet({
  accounts,
  categories,
  onApply,
  onClose,
  owners,
  value,
  visible,
}: {
  accounts: AccountOption[];
  categories: string[];
  onApply: (value: ActivityCriteria) => void;
  onClose: () => void;
  owners: string[];
  value: ActivityCriteria;
  visible: boolean;
}) {
  const colors = useAppColors();
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (visible) setDraft(value);
  }, [value, visible]);

  const datesValid =
    validDate(draft.startDate) &&
    validDate(draft.endDate) &&
    (!draft.startDate || !draft.endDate || draft.startDate <= draft.endDate);

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      visible={visible}
    >
      <View style={[styles.sheet, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.separator }]}>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.headerButton}>
            <Text style={[styles.headerAction, { color: colors.accent }]}>Cancel</Text>
          </Pressable>
          <Text style={[styles.title, { color: colors.text }]}>Filter activity</Text>
          <Pressable
            accessibilityRole="button"
            disabled={!datesValid}
            onPress={() => onApply(draft)}
            style={styles.headerButton}
          >
            <Text
              style={[
                styles.headerAction,
                styles.done,
                { color: datesValid ? colors.accent : colors.tertiary },
              ]}
            >
              Done
            </Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.sectionHeading}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Date range</Text>
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={() =>
                setDraft((current) => ({ ...current, startDate: undefined, endDate: undefined }))
              }
            >
              <Text style={[styles.clear, { color: colors.accent }]}>All dates</Text>
            </Pressable>
          </View>
          <View style={styles.dateRow}>
            <DateField
              colors={colors}
              label="From"
              onChange={(startDate) => setDraft((current) => ({ ...current, startDate }))}
              value={draft.startDate}
            />
            <DateField
              colors={colors}
              label="To"
              onChange={(endDate) => setDraft((current) => ({ ...current, endDate }))}
              value={draft.endDate}
            />
          </View>
          {!datesValid ? (
            <Text style={[styles.error, { color: colors.danger }]}>
              Use valid YYYY-MM-DD dates.
            </Text>
          ) : null}

          <ChoiceSection
            colors={colors}
            label="Category"
            onSelect={(category) => setDraft((current) => ({ ...current, category }))}
            options={categories.map((category) => ({ label: category, value: category }))}
            selected={draft.category}
          />
          <ChoiceSection
            colors={colors}
            label="Account"
            onSelect={(account) => {
              const option = accounts.find((item) => item.label === account);
              setDraft((current) => ({ ...current, account, accountId: option?.id }));
            }}
            options={accounts.map((account) => ({ label: account.label, value: account.label }))}
            selected={draft.account}
          />
          <ChoiceSection
            colors={colors}
            label="Owner"
            onSelect={(owner) => setDraft((current) => ({ ...current, owner }))}
            options={owners.map((owner) => ({ label: owner, value: owner }))}
            selected={draft.owner}
          />
          <ChoiceSection
            colors={colors}
            label="Status"
            onSelect={(status) =>
              setDraft((current) => ({ ...current, status: status as ActivityCriteria['status'] }))
            }
            options={[
              { label: 'Posted', value: 'posted' },
              { label: 'Pending', value: 'pending' },
            ]}
            selected={draft.status}
          />
          <ChoiceSection
            colors={colors}
            label="Money flow"
            onSelect={(direction) =>
              setDraft((current) => ({
                ...current,
                direction: direction as ActivityCriteria['direction'],
              }))
            }
            options={[
              { label: 'Expenses', value: 'debit' },
              { label: 'Credits', value: 'credit' },
            ]}
            selected={draft.direction}
          />
          <ChoiceSection
            colors={colors}
            label="Reports"
            onSelect={(inclusion) =>
              setDraft((current) => ({
                ...current,
                inclusion: inclusion as ActivityCriteria['inclusion'],
              }))
            }
            options={[
              { label: 'Included', value: 'included' },
              { label: 'Excluded', value: 'excluded' },
            ]}
            selected={draft.inclusion === 'all' ? undefined : draft.inclusion}
          />

          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: Boolean(draft.needsReview) }}
            onPress={() =>
              setDraft((current) => ({
                ...current,
                needsReview: current.needsReview ? undefined : true,
              }))
            }
            style={[styles.reviewRow, { borderColor: colors.separator }]}
          >
            <View>
              <Text style={[styles.reviewTitle, { color: colors.text }]}>Needs review only</Text>
              <Text style={[styles.reviewNote, { color: colors.secondary }]}>
                Your financial inbox
              </Text>
            </View>
            <SymbolView
              name={draft.needsReview ? 'checkmark.circle.fill' : 'circle'}
              size={22}
              tintColor={draft.needsReview ? colors.accent : colors.tertiary}
            />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => setDraft({ inclusion: 'all' })}
            style={({ pressed }) => [styles.reset, { opacity: pressed ? 0.62 : 1 }]}
          >
            <Text style={[styles.resetText, { color: colors.danger }]}>Reset all filters</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

function DateField({
  colors,
  label,
  onChange,
  value,
}: {
  colors: AppColors;
  label: string;
  onChange: (value: string | undefined) => void;
  value?: string;
}) {
  return (
    <View style={styles.dateFieldWrap}>
      <Text style={[styles.dateLabel, { color: colors.secondary }]}>{label}</Text>
      <TextInput
        accessibilityLabel={`${label} date`}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="numbers-and-punctuation"
        maxLength={10}
        onChangeText={(text) => onChange(text || undefined)}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.tertiary}
        style={[
          styles.dateField,
          {
            backgroundColor: colors.surfaceSoft,
            color: colors.text,
            borderColor: colors.separator,
          },
        ]}
        value={value ?? ''}
      />
    </View>
  );
}

function ChoiceSection({
  colors,
  label,
  onSelect,
  options,
  selected,
}: {
  colors: AppColors;
  label: string;
  onSelect: (value: string | undefined) => void;
  options: Array<{ label: string; value: string }>;
  selected?: string;
}) {
  if (!options.length) return null;
  return (
    <View style={styles.choiceSection}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{label}</Text>
      <ScrollView
        horizontal
        contentContainerStyle={styles.choices}
        showsHorizontalScrollIndicator={false}
      >
        <Choice
          label="All"
          selected={!selected}
          onPress={() => onSelect(undefined)}
          colors={colors}
        />
        {options.map((option) => (
          <Choice
            colors={colors}
            key={option.value}
            label={option.label}
            onPress={() => onSelect(option.value)}
            selected={selected === option.value}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function Choice({
  colors,
  label,
  onPress,
  selected,
}: {
  colors: AppColors;
  label: string;
  onPress: () => void;
  selected: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        {
          backgroundColor: selected ? colors.accent : colors.surfaceSoft,
          borderColor: selected ? colors.accent : colors.separator,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text
        numberOfLines={1}
        style={[styles.choiceText, { color: selected ? '#FFFFFF' : colors.text }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: {
    minHeight: 58,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerButton: { width: 76, minHeight: 44, justifyContent: 'center' },
  headerAction: { fontSize: 16 },
  done: { textAlign: 'right', fontWeight: '700' },
  title: { fontSize: 17, lineHeight: 22, fontWeight: '700' },
  content: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 44 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 16, lineHeight: 21, fontWeight: '700' },
  clear: { fontSize: 13, fontWeight: '600' },
  dateRow: { marginTop: 11, flexDirection: 'row', gap: 10 },
  dateFieldWrap: { flex: 1 },
  dateLabel: { marginBottom: 5, fontSize: 12, fontWeight: '600' },
  dateField: {
    height: 46,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
  error: { marginTop: 7, fontSize: 12.5, fontWeight: '600' },
  choiceSection: { marginTop: 26 },
  choices: { paddingTop: 10, paddingRight: 20, gap: 8 },
  choice: {
    minHeight: 42,
    maxWidth: 220,
    paddingHorizontal: 14,
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceText: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  reviewRow: {
    minHeight: 68,
    marginTop: 28,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reviewTitle: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  reviewNote: { marginTop: 2, fontSize: 12.5, lineHeight: 17 },
  reset: { minHeight: 52, marginTop: 20, alignItems: 'center', justifyContent: 'center' },
  resetText: { fontSize: 15, fontWeight: '600' },
});
