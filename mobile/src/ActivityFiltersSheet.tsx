import DateTimePicker from '@react-native-community/datetimepicker';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { ActivityCriteria } from './MoneyData';
import { useAppColors, type AppColors } from './theme';

type AccountOption = { id?: string; label: string };
type ChoiceKey = 'category' | 'account' | 'owner' | 'status' | 'direction' | 'inclusion';
type ChoiceOption = { label: string; value?: string };

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
  currentDate,
  onApply,
  onClose,
  owners,
  value,
  visible,
}: {
  accounts: AccountOption[];
  categories: string[];
  currentDate: string;
  onApply: (value: ActivityCriteria) => void;
  onClose: () => void;
  owners: string[];
  value: ActivityCriteria;
  visible: boolean;
}) {
  const colors = useAppColors();
  const [draft, setDraft] = useState(value);
  const [picker, setPicker] = useState<ChoiceKey | null>(null);

  useEffect(() => {
    if (visible) {
      setDraft(value);
      setPicker(null);
    }
  }, [value, visible]);

  const datesValid =
    validDate(draft.startDate) &&
    validDate(draft.endDate) &&
    (!draft.startDate || !draft.endDate || draft.startDate <= draft.endDate);
  const choice = picker ? choiceFor(picker, draft, categories, accounts, owners) : null;

  const selectChoice = (selected: string | undefined) => {
    if (!picker) return;
    if (picker === 'account') {
      const account = accounts.find((item) => item.label === selected);
      setDraft((current) => ({ ...current, account: selected, accountId: account?.id }));
    } else if (picker === 'inclusion') {
      setDraft((current) => ({
        ...current,
        inclusion: (selected as ActivityCriteria['inclusion']) ?? 'all',
      }));
    } else {
      setDraft((current) => ({ ...current, [picker]: selected }));
    }
    setPicker(null);
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={picker ? () => setPicker(null) : onClose}
      presentationStyle="pageSheet"
      visible={visible}
    >
      <View style={[styles.sheet, { backgroundColor: colors.background }]}>
        {choice && picker ? (
          <ChoiceList
            colors={colors}
            onBack={() => setPicker(null)}
            onSelect={selectChoice}
            options={choice.options}
            selected={choice.selected}
            title={choice.title}
          />
        ) : (
          <>
            <SheetHeader
              colors={colors}
              datesValid={datesValid}
              onApply={() => onApply(draft)}
              onClose={onClose}
            />
            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
              <SectionLabel label="Date range" colors={colors} />
              <View style={[styles.group, { backgroundColor: colors.surface }]}>
                <DateFilterRow
                  colors={colors}
                  currentDate={currentDate}
                  label="From"
                  onChange={(startDate) => setDraft((current) => ({ ...current, startDate }))}
                  value={draft.startDate}
                />
                <View style={[styles.divider, { backgroundColor: colors.separator }]} />
                <DateFilterRow
                  colors={colors}
                  currentDate={currentDate}
                  label="To"
                  onChange={(endDate) => setDraft((current) => ({ ...current, endDate }))}
                  value={draft.endDate}
                />
              </View>
              {!datesValid ? (
                <Text style={[styles.error, { color: colors.danger }]}>
                  The start date must be before the end date.
                </Text>
              ) : null}

              <SectionLabel label="Transaction" colors={colors} />
              <View style={[styles.group, { backgroundColor: colors.surface }]}>
                <FilterRow
                  colors={colors}
                  icon="tag"
                  label="Category"
                  onPress={() => setPicker('category')}
                  value={draft.category ?? 'All'}
                />
                <View style={[styles.divider, { backgroundColor: colors.separator }]} />
                <FilterRow
                  colors={colors}
                  icon="creditcard"
                  label="Account"
                  onPress={() => setPicker('account')}
                  value={draft.account ?? 'All'}
                />
                <View style={[styles.divider, { backgroundColor: colors.separator }]} />
                <FilterRow
                  colors={colors}
                  icon="person.2"
                  label="Owner"
                  onPress={() => setPicker('owner')}
                  value={draft.owner ?? 'All'}
                />
              </View>

              <SectionLabel label="State" colors={colors} />
              <View style={[styles.group, { backgroundColor: colors.surface }]}>
                <FilterRow
                  colors={colors}
                  icon="clock"
                  label="Status"
                  onPress={() => setPicker('status')}
                  value={
                    draft.status === 'pending'
                      ? 'Pending'
                      : draft.status === 'posted'
                        ? 'Posted'
                        : 'All'
                  }
                />
                <View style={[styles.divider, { backgroundColor: colors.separator }]} />
                <FilterRow
                  colors={colors}
                  icon="arrow.left.arrow.right"
                  label="Money flow"
                  onPress={() => setPicker('direction')}
                  value={
                    draft.direction === 'debit'
                      ? 'Expenses'
                      : draft.direction === 'credit'
                        ? 'Credits'
                        : 'All'
                  }
                />
                <View style={[styles.divider, { backgroundColor: colors.separator }]} />
                <FilterRow
                  colors={colors}
                  icon="doc.text"
                  label="Reports"
                  onPress={() => setPicker('inclusion')}
                  value={
                    draft.inclusion === 'included'
                      ? 'Included'
                      : draft.inclusion === 'excluded'
                        ? 'Excluded'
                        : 'All'
                  }
                />
                <View style={[styles.divider, { backgroundColor: colors.separator }]} />
                <View style={styles.toggleRow}>
                  <View style={styles.rowLeading}>
                    <View style={[styles.rowIcon, { backgroundColor: colors.accentSoft }]}>
                      <SymbolView name="checkmark.circle" size={15} tintColor={colors.accent} />
                    </View>
                    <Text style={[styles.rowLabel, { color: colors.text }]}>Needs review</Text>
                  </View>
                  <Switch
                    accessibilityLabel="Needs review only"
                    onValueChange={(needsReview) =>
                      setDraft((current) => ({
                        ...current,
                        needsReview: needsReview || undefined,
                      }))
                    }
                    trackColor={{ false: colors.separator, true: colors.accent }}
                    testID="activity-filter-needs-review"
                    value={Boolean(draft.needsReview)}
                  />
                </View>
              </View>

              <Pressable
                accessibilityRole="button"
                onPress={() => setDraft({ inclusion: 'all' })}
                style={({ pressed }) => [styles.reset, { opacity: pressed ? 0.62 : 1 }]}
                testID="activity-reset-filters"
              >
                <Text style={[styles.resetText, { color: colors.danger }]}>Reset all filters</Text>
              </Pressable>
            </ScrollView>
          </>
        )}
      </View>
    </Modal>
  );
}

function SheetHeader({
  colors,
  datesValid,
  onApply,
  onClose,
}: {
  colors: AppColors;
  datesValid: boolean;
  onApply: () => void;
  onClose: () => void;
}) {
  return (
    <View style={[styles.header, { borderBottomColor: colors.separator }]}>
      <Pressable accessibilityRole="button" onPress={onClose} style={styles.headerButton}>
        <Text style={[styles.headerAction, { color: colors.accent }]}>Cancel</Text>
      </Pressable>
      <Text style={[styles.title, { color: colors.text }]}>Filter activity</Text>
      <Pressable
        accessibilityRole="button"
        disabled={!datesValid}
        onPress={onApply}
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
  );
}

function SectionLabel({ label, colors }: { label: string; colors: AppColors }) {
  return <Text style={[styles.sectionLabel, { color: colors.secondary }]}>{label}</Text>;
}

function FilterRow({
  colors,
  icon,
  label,
  onPress,
  value,
}: {
  colors: AppColors;
  icon: SFSymbol;
  label: string;
  onPress: () => void;
  value: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.filterRow,
        { backgroundColor: pressed ? colors.surfaceSoft : colors.surface },
      ]}
    >
      <View style={styles.rowLeading}>
        <View style={[styles.rowIcon, { backgroundColor: colors.accentSoft }]}>
          <SymbolView name={icon} size={15} tintColor={colors.accent} />
        </View>
        <Text style={[styles.rowLabel, { color: colors.text }]}>{label}</Text>
      </View>
      <View style={styles.rowTrailing}>
        <Text numberOfLines={1} style={[styles.rowValue, { color: colors.secondary }]}>
          {value}
        </Text>
        <SymbolView name="chevron.right" size={11} tintColor={colors.tertiary} />
      </View>
    </Pressable>
  );
}

function DateFilterRow({
  colors,
  currentDate,
  label,
  onChange,
  value,
}: {
  colors: AppColors;
  currentDate: string;
  label: string;
  onChange: (value: string | undefined) => void;
  value?: string;
}) {
  return (
    <View style={styles.filterRow}>
      <View style={styles.rowLeading}>
        <View style={[styles.rowIcon, { backgroundColor: colors.accentSoft }]}>
          <SymbolView name="calendar" size={15} tintColor={colors.accent} />
        </View>
        <Text style={[styles.rowLabel, { color: colors.text }]}>{label}</Text>
      </View>
      {value ? (
        <View style={styles.dateControl}>
          <DateTimePicker
            display="compact"
            maximumDate={dateFromValue(currentDate)}
            mode="date"
            onChange={(_, date) => {
              if (date) onChange(valueFromDate(date));
            }}
            value={dateFromValue(value)}
          />
          <Pressable
            accessibilityLabel={`Clear ${label.toLocaleLowerCase()} date`}
            accessibilityRole="button"
            hitSlop={6}
            onPress={() => onChange(undefined)}
            style={styles.clearDate}
          >
            <SymbolView name="xmark.circle.fill" size={17} tintColor={colors.tertiary} />
          </Pressable>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => onChange(currentDate)}
          style={styles.chooseDate}
        >
          <Text style={[styles.chooseDateText, { color: colors.accent }]}>Choose</Text>
        </Pressable>
      )}
    </View>
  );
}

function ChoiceList({
  colors,
  onBack,
  onSelect,
  options,
  selected,
  title,
}: {
  colors: AppColors;
  onBack: () => void;
  onSelect: (value: string | undefined) => void;
  options: ChoiceOption[];
  selected?: string;
  title: string;
}) {
  const [query, setQuery] = useState('');
  const searchable = options.length > 10;
  const visibleOptions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? options.filter((option) => option.label.toLocaleLowerCase().includes(normalized))
      : options;
  }, [options, query]);

  return (
    <>
      <View style={[styles.header, { borderBottomColor: colors.separator }]}>
        <Pressable accessibilityRole="button" onPress={onBack} style={styles.backButton}>
          <SymbolView name="chevron.left" size={13} tintColor={colors.accent} />
          <Text style={[styles.headerAction, { color: colors.accent }]}>Filters</Text>
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        <View style={styles.headerButton} />
      </View>
      {searchable ? (
        <View style={[styles.search, { backgroundColor: colors.surfaceSoft }]}>
          <SymbolView name="magnifyingglass" size={15} tintColor={colors.tertiary} />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            onChangeText={setQuery}
            placeholder={`Search ${title.toLocaleLowerCase()}`}
            placeholderTextColor={colors.tertiary}
            style={[styles.searchInput, { color: colors.text }]}
            value={query}
          />
        </View>
      ) : null}
      <FlatList
        contentContainerStyle={styles.choiceList}
        data={visibleOptions}
        initialNumToRender={14}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(item) => item.value ?? 'all'}
        maxToRenderPerBatch={12}
        renderItem={({ item }) => {
          const isSelected = item.value === selected || (!item.value && !selected);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              onPress={() => onSelect(item.value)}
              style={({ pressed }) => [
                styles.choiceRow,
                {
                  backgroundColor: pressed ? colors.surfaceSoft : colors.background,
                  borderBottomColor: colors.separator,
                },
              ]}
            >
              <Text style={[styles.choiceText, { color: colors.text }]}>{item.label}</Text>
              {isSelected ? (
                <SymbolView name="checkmark" size={15} tintColor={colors.accent} />
              ) : null}
            </Pressable>
          );
        }}
        windowSize={7}
      />
    </>
  );
}

function choiceFor(
  picker: ChoiceKey,
  draft: ActivityCriteria,
  categories: string[],
  accounts: AccountOption[],
  owners: string[],
) {
  const all = { label: 'All', value: undefined };
  const choices: Record<ChoiceKey, { title: string; selected?: string; options: ChoiceOption[] }> =
    {
      category: {
        title: 'Category',
        selected: draft.category,
        options: [all, ...categories.map((value) => ({ label: value, value }))],
      },
      account: {
        title: 'Account',
        selected: draft.account,
        options: [all, ...accounts.map(({ label }) => ({ label, value: label }))],
      },
      owner: {
        title: 'Owner',
        selected: draft.owner,
        options: [all, ...owners.map((value) => ({ label: value, value }))],
      },
      status: {
        title: 'Status',
        selected: draft.status,
        options: [
          all,
          { label: 'Posted', value: 'posted' },
          { label: 'Pending', value: 'pending' },
        ],
      },
      direction: {
        title: 'Money flow',
        selected: draft.direction,
        options: [
          all,
          { label: 'Expenses', value: 'debit' },
          { label: 'Credits', value: 'credit' },
        ],
      },
      inclusion: {
        title: 'Reports',
        selected: draft.inclusion === 'all' ? undefined : draft.inclusion,
        options: [
          all,
          { label: 'Included', value: 'included' },
          { label: 'Excluded', value: 'excluded' },
        ],
      },
    };
  return choices[picker];
}

function dateFromValue(value: string) {
  return new Date(`${value}T12:00:00`);
}

function valueFromDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
  backButton: {
    width: 92,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  headerAction: { fontSize: 16 },
  done: { textAlign: 'right', fontWeight: '700' },
  title: { fontSize: 17, lineHeight: 22, fontWeight: '700' },
  content: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 44 },
  sectionLabel: {
    marginTop: 20,
    marginBottom: 7,
    marginLeft: 4,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  group: { borderRadius: 16, overflow: 'hidden' },
  filterRow: {
    minHeight: 54,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 54 },
  rowLeading: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  rowIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { fontSize: 16, lineHeight: 21, fontWeight: '500' },
  rowTrailing: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
  },
  rowValue: { flexShrink: 1, maxWidth: 170, fontSize: 14, lineHeight: 19, textAlign: 'right' },
  toggleRow: {
    minHeight: 58,
    paddingLeft: 13,
    paddingRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateControl: { flexDirection: 'row', alignItems: 'center' },
  clearDate: { width: 36, height: 44, alignItems: 'flex-end', justifyContent: 'center' },
  chooseDate: { minWidth: 72, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
  chooseDateText: { fontSize: 15, fontWeight: '600' },
  error: { marginTop: 7, marginHorizontal: 4, fontSize: 12.5, lineHeight: 17, fontWeight: '600' },
  reset: { minHeight: 52, marginTop: 18, alignItems: 'center', justifyContent: 'center' },
  resetText: { fontSize: 15, fontWeight: '600' },
  search: {
    minHeight: 44,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 13,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: { flex: 1, height: 44, fontSize: 16 },
  choiceList: { paddingHorizontal: 20, paddingBottom: 30 },
  choiceRow: {
    minHeight: 54,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  choiceText: { flex: 1, marginRight: 12, fontSize: 17, lineHeight: 22 },
});
