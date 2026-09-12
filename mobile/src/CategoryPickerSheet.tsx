import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppColors } from './theme';

const sheetSpring = { damping: 28, stiffness: 300, mass: 0.82 };

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

export function CategoryPickerSheet({
  categories,
  onClose,
  onSelect,
  selected,
  title = 'Choose category',
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
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const [query, setQuery] = useState('');
  const hiddenOffset = Math.max(height * 0.6, 440);
  const translateY = useSharedValue(hiddenOffset);
  const backdropOpacity = useSharedValue(0);
  const closing = useSharedValue(false);
  const visibleCategories = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return categories.filter((category) => category.toLocaleLowerCase().includes(normalized));
  }, [categories, query]);

  useEffect(() => {
    if (!visible) {
      setQuery('');
      translateY.value = hiddenOffset;
      backdropOpacity.value = 0;
      closing.value = false;
    }
    return () => Keyboard.dismiss();
  }, [backdropOpacity, closing, hiddenOffset, translateY, visible]);

  const present = useCallback(() => {
    cancelAnimation(translateY);
    cancelAnimation(backdropOpacity);
    closing.value = false;
    translateY.value = reduceMotion ? 0 : hiddenOffset;
    backdropOpacity.value = reduceMotion ? 1 : 0;
    if (!reduceMotion) {
      translateY.value = withSpring(0, sheetSpring);
      backdropOpacity.value = withTiming(1, { duration: 180 });
    }
  }, [backdropOpacity, closing, hiddenOffset, reduceMotion, translateY]);

  const dismiss = useCallback(
    (completion: () => void) => {
      if (closing.value) return;
      closing.value = true;
      Keyboard.dismiss();
      if (reduceMotion) {
        translateY.value = hiddenOffset;
        backdropOpacity.value = 0;
        completion();
        return;
      }
      backdropOpacity.value = withTiming(0, { duration: 140 });
      translateY.value = withTiming(hiddenOffset, { duration: 180 }, () => {
        runOnJS(completion)();
      });
    },
    [backdropOpacity, closing, hiddenOffset, reduceMotion, translateY],
  );
  const close = useCallback(() => dismiss(onClose), [dismiss, onClose]);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(6)
        .failOffsetX([-24, 24])
        .onUpdate((event) => {
          translateY.value = Math.max(0, event.translationY);
        })
        .onEnd((event) => {
          if (event.translationY > 72 || event.velocityY > 900) runOnJS(close)();
          else translateY.value = withSpring(0, sheetSpring);
        }),
    [close, translateY],
  );

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity:
      backdropOpacity.value * (1 - Math.min(Math.max(translateY.value / hiddenOffset, 0), 1)),
  }));

  return (
    <Modal
      animationType="none"
      onDismiss={() => Keyboard.dismiss()}
      onRequestClose={close}
      onShow={present}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            onPress={close}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              paddingBottom: Math.max(insets.bottom, 12),
            },
            sheetStyle,
          ]}
          testID="category-picker-sheet"
        >
          <GestureDetector gesture={panGesture}>
            <View style={styles.grabberArea}>
              <View style={[styles.grabber, { backgroundColor: colors.tertiary }]} />
            </View>
          </GestureDetector>
          <View style={styles.header}>
            <Pressable accessibilityRole="button" onPress={close} style={styles.headerButton}>
              <Text style={[styles.cancel, { color: colors.accent }]}>Cancel</Text>
            </Pressable>
            <View style={styles.heading}>
              <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
              <Text style={[styles.count, { color: colors.secondary }]}>
                {categories.length} categories
              </Text>
            </View>
            <View style={styles.headerButton} />
          </View>
          <View
            style={[
              styles.search,
              {
                backgroundColor: colors.surfaceSoft,
                borderColor: colors.separator,
              },
            ]}
          >
            <SymbolView name="magnifyingglass" size={16} tintColor={colors.secondary} />
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              onChangeText={setQuery}
              onSubmitEditing={() => Keyboard.dismiss()}
              placeholder="Search categories"
              placeholderTextColor={colors.tertiary}
              returnKeyType="done"
              style={[styles.searchInput, { color: colors.text }]}
              testID="category-search"
              value={query}
            />
          </View>
          <Text style={[styles.listLabel, { color: colors.secondary }]}>
            {query.trim() ? `${visibleCategories.length} RESULTS` : 'ALL CATEGORIES'}
          </Text>
          <FlatList
            columnWrapperStyle={styles.columns}
            contentContainerStyle={styles.list}
            data={visibleCategories}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            keyExtractor={(item) => item}
            numColumns={2}
            renderItem={({ item }) => {
              const isSelected = selected === item;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => {
                    dismiss(() => onSelect(item));
                  }}
                  style={({ pressed }) => [
                    styles.option,
                    {
                      backgroundColor: isSelected ? colors.accentSoft : colors.surfaceSoft,
                      borderColor: isSelected ? colors.accent : colors.separator,
                      opacity: pressed ? 0.76 : 1,
                    },
                  ]}
                  testID={`category-option-${item}`}
                >
                  <View style={[styles.icon, { backgroundColor: colors.surface }]}>
                    <SymbolView
                      name={categorySymbols[item] ?? 'tag'}
                      size={15}
                      tintColor={colors.accent}
                    />
                  </View>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.optionLabel,
                      { color: isSelected ? colors.accent : colors.text },
                    ]}
                  >
                    {item}
                  </Text>
                  {isSelected ? (
                    <SymbolView name="checkmark.circle.fill" size={14} tintColor={colors.accent} />
                  ) : null}
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <View style={styles.empty}>
                <SymbolView name="magnifyingglass" size={26} tintColor={colors.secondary} />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>
                  No matching category
                </Text>
                <Text style={[styles.emptyBody, { color: colors.secondary }]}>
                  Try a shorter search.
                </Text>
              </View>
            }
          />
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(9,17,31,0.24)' },
  sheet: {
    height: '55%',
    minHeight: 400,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    overflow: 'hidden',
  },
  grabberArea: { height: 20, alignItems: 'center', justifyContent: 'center' },
  grabber: { width: 36, height: 5, borderRadius: 3, opacity: 0.35 },
  header: {
    minHeight: 48,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerButton: { width: 74, minHeight: 44, justifyContent: 'center' },
  cancel: { fontSize: 16 },
  heading: { alignItems: 'center' },
  title: { fontSize: 18, lineHeight: 23, fontWeight: '700', letterSpacing: -0.25 },
  count: { marginTop: 2, fontSize: 11.5 },
  search: {
    minHeight: 44,
    marginHorizontal: 16,
    paddingHorizontal: 13,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  searchInput: { flex: 1, height: 42, fontSize: 16 },
  listLabel: {
    marginTop: 13,
    marginHorizontal: 18,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  list: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, flexGrow: 1 },
  columns: { gap: 8 },
  option: {
    flex: 1,
    minWidth: 0,
    minHeight: 46,
    marginBottom: 7,
    paddingHorizontal: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  icon: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  optionLabel: { flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 16, fontWeight: '600' },
  empty: { flex: 1, minHeight: 220, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { marginTop: 12, fontSize: 18, fontWeight: '700' },
  emptyBody: { marginTop: 4, fontSize: 14 },
});
