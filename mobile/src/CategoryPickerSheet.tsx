import { t, useLanguage } from './localization';
import { categoryLabel, fixtureCategoryKey } from './translations';
import { Text } from './LocalizedText';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppColors } from './theme';

const categorySymbols: Record<string, SFSymbol> = {
  Dining: 'fork.knife',
  Groceries: 'cart',
  Housing: 'house',
  Transport: 'car',
  Travel: 'airplane',
  Shopping: 'bag',
  Health: 'cross.case',
  Subscriptions: 'rectangle.stack',
  Utilities: 'bolt',
  Entertainment: 'play.rectangle',
  Education: 'book',
  Personal: 'person',
  Gifts: 'gift',
  Insurance: 'shield',
  Taxes: 'building.columns',
  Pets: 'pawprint',
  Fees: 'creditcard',
  Transfer: 'arrow.left.arrow.right',
  Income: 'banknote',
  Other: 'ellipsis.circle',
};

// A native page sheet with a single-column list: swipe down or Cancel to leave, tap a row to pick.
export function CategoryPickerSheet({
  categories,
  onClose,
  onSelect,
  selected,
  title = t('chooseCategory'),
  visible,
}: {
  categories: string[];
  onClose: () => void;
  onSelect: (category: string) => void;
  selected?: string;
  title?: string;
  visible: boolean;
}) {
  const colors = useAppColors();
  const { language } = useLanguage();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [query, setQuery] = useState('');
  const list = useRef<ScrollView>(null);
  const opening = useRef({
    content: 0,
    selectedY: null as number | null,
    mode: 'awaiting-layout' as 'awaiting-layout' | 'revealing' | 'user-controlled',
    viewport: 0,
  });
  const searching = query.trim().length > 0;
  const visibleCategories = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return categories.filter(
      (category) =>
        category.toLocaleLowerCase().includes(normalized) ||
        categoryLabel(category).toLocaleLowerCase().includes(normalized),
    );
  }, [categories, query]);

  useEffect(() => {
    if (visible) return;
    setQuery('');
    opening.current = { content: 0, selectedY: null, mode: 'awaiting-layout', viewport: 0 };
  }, [visible]);

  // Open with the current choice in view. The sheet's size settles after the first layout, so
  // this reruns on each measurement, clamped to the list's end, until the person scrolls.
  function revealSelection() {
    const { content, selectedY, mode, viewport } = opening.current;
    if (mode === 'user-controlled' || searching || selectedY === null || !content || !viewport)
      return;
    const offset = Math.min(selectedY - 160, content - viewport);
    opening.current.mode = 'revealing';
    list.current?.scrollTo({ y: Math.max(0, offset), animated: false });
  }

  return (
    <Modal
      animationType={reduceMotion ? 'none' : 'slide'}
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      visible={visible}
    >
      <View
        style={[styles.sheet, { backgroundColor: colors.background }]}
        testID="category-picker-sheet"
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={onClose}
            style={styles.cancelButton}
          >
            <Text
              maxFontSizeMultiplier={1.3}
              numberOfLines={1}
              style={[styles.cancel, { color: colors.accent }]}
            >
              {t('cancel')}
            </Text>
          </Pressable>
          <Text
            accessibilityRole="header"
            maxFontSizeMultiplier={1.3}
            numberOfLines={1}
            style={[styles.title, { color: colors.text }]}
          >
            {title}
          </Text>
        </View>
        <View style={[styles.search, { backgroundColor: colors.surfaceSoft }]}>
          <SymbolView name="magnifyingglass" size={16} tintColor={colors.secondary} />
          <TextInput
            accessibilityLabel={t('searchCategories')}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            onChangeText={setQuery}
            placeholder={t('searchCategories')}
            placeholderTextColor={colors.tertiary}
            returnKeyType="search"
            style={[
              styles.searchInput,
              {
                color: colors.text,
                textAlign: language === 'he' ? 'right' : 'left',
                writingDirection: language === 'he' ? 'rtl' : 'ltr',
              },
            ]}
            testID="category-search"
            value={query}
          />
        </View>
        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: Math.max(insets.bottom, 16) },
          ]}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={(_width, height) => {
            opening.current.content = height;
            revealSelection();
          }}
          onLayout={({ nativeEvent }) => {
            opening.current.viewport = nativeEvent.layout.height;
            revealSelection();
          }}
          onScrollBeginDrag={() => {
            opening.current.mode = 'user-controlled';
          }}
          ref={list}
        >
          {visibleCategories.length ? (
            <View style={[styles.group, { backgroundColor: colors.surface }]}>
              {visibleCategories.map((category, index) => {
                const isSelected = selected === category;
                return (
                  <Pressable
                    accessibilityLabel={categoryLabel(category)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    key={category}
                    onLayout={
                      isSelected
                        ? ({ nativeEvent }) => {
                            opening.current.selectedY = nativeEvent.layout.y;
                            revealSelection();
                          }
                        : undefined
                    }
                    onPress={() => onSelect(category)}
                    style={({ pressed }) => [
                      styles.option,
                      pressed && { backgroundColor: colors.surfaceSoft },
                    ]}
                    testID={`category-option-${category}`}
                  >
                    <SymbolView
                      name={categorySymbols[fixtureCategoryKey(category)] ?? 'tag'}
                      size={20}
                      style={styles.symbol}
                      tintColor={colors.accent}
                    />
                    <View
                      style={[
                        styles.optionBody,
                        index < visibleCategories.length - 1 && {
                          borderBottomColor: colors.separator,
                          borderBottomWidth: StyleSheet.hairlineWidth,
                        },
                      ]}
                    >
                      <Text style={[styles.optionLabel, { color: colors.text }]}>
                        {categoryLabel(category)}
                      </Text>
                      {isSelected ? (
                        <SymbolView name="checkmark" size={16} tintColor={colors.accent} />
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Text style={[styles.empty, { color: colors.secondary }]}>
              {t('noMatchingCategory')}
            </Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { minHeight: 56, justifyContent: 'center', paddingHorizontal: 16 },
  cancelButton: {
    position: 'absolute',
    start: 16,
    zIndex: 1,
    minHeight: 44,
    maxWidth: '30%',
    justifyContent: 'center',
  },
  cancel: { fontSize: 17 },
  // Centered across the sheet; the side padding keeps it clear of Cancel at large text.
  title: { paddingHorizontal: '24%', fontSize: 17, fontWeight: '600', textAlign: 'center' },
  search: {
    minHeight: 40,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 10,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  searchInput: { flex: 1, minHeight: 40, fontSize: 17 },
  listContent: { paddingHorizontal: 16 },
  group: { borderRadius: 14, overflow: 'hidden' },
  option: { minHeight: 50, flexDirection: 'row', alignItems: 'stretch', paddingStart: 14 },
  symbol: { width: 24, height: 24, alignSelf: 'center' },
  optionBody: {
    flex: 1,
    minHeight: 50,
    marginStart: 12,
    paddingEnd: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  optionLabel: { flex: 1, fontSize: 17, lineHeight: 22 },
  empty: { marginTop: 48, fontSize: 15, textAlign: 'center' },
});
