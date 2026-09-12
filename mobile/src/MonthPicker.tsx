import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppColors } from './theme';

export function formatMonthLabel(month: string, short = false) {
  return new Intl.DateTimeFormat('en', {
    month: short ? 'short' : 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T12:00:00Z`));
}

export function MonthPicker({
  month,
  months,
  onSelect,
  testID,
}: {
  month: string;
  months: string[];
  onSelect: (month: string) => void;
  testID?: string;
}) {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const options = useMemo(
    () => (months.includes(month) ? months : [month, ...months]).filter(Boolean),
    [month, months],
  );

  return (
    <>
      <Pressable
        accessibilityHint="Choose another month"
        accessibilityRole="button"
        onPress={() => setVisible(true)}
        style={({ pressed }) => [styles.trigger, { opacity: pressed ? 0.64 : 1 }]}
        testID={testID}
      >
        <SymbolView name="calendar" size={14} tintColor={colors.accent} />
        <Text numberOfLines={1} style={[styles.triggerText, { color: colors.text }]}>
          {formatMonthLabel(month)}
        </Text>
        <SymbolView name="chevron.down" size={11} tintColor={colors.tertiary} />
      </Pressable>

      <Modal
        animationType="slide"
        onRequestClose={() => setVisible(false)}
        presentationStyle="pageSheet"
        visible={visible}
      >
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.background, paddingBottom: Math.max(insets.bottom, 16) },
          ]}
        >
          <View style={[styles.header, { borderBottomColor: colors.separator }]}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setVisible(false)}
              style={styles.headerButton}
            >
              <Text style={[styles.cancel, { color: colors.accent }]}>Cancel</Text>
            </Pressable>
            <Text style={[styles.title, { color: colors.text }]}>Choose month</Text>
            <View style={styles.headerButton} />
          </View>
          <FlatList
            contentContainerStyle={styles.list}
            data={options}
            keyExtractor={(item) => item}
            renderItem={({ item }) => {
              const selected = item === month;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    onSelect(item);
                    setVisible(false);
                  }}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      backgroundColor: pressed ? colors.surfaceSoft : colors.background,
                      borderBottomColor: colors.separator,
                    },
                  ]}
                  testID={`month-option-${item}`}
                >
                  <Text style={[styles.month, { color: colors.text }]}>
                    {formatMonthLabel(item)}
                  </Text>
                  {selected ? (
                    <SymbolView name="checkmark" size={16} tintColor={colors.accent} />
                  ) : null}
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  triggerText: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
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
  cancel: { fontSize: 16 },
  title: { fontSize: 17, lineHeight: 22, fontWeight: '700' },
  list: { paddingHorizontal: 20 },
  row: {
    minHeight: 58,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  month: { fontSize: 17, lineHeight: 23 },
});
