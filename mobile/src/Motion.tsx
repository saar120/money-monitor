import type { PropsWithChildren } from 'react';
import { useEffect } from 'react';
import { Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  LinearTransition,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useLanguage } from './localization';
import { chartIndexAtPosition, adjacentMonth } from './motion-state';

export function RollingAmount({
  value,
  style,
  testID,
}: {
  value: string;
  style: StyleProp<TextStyle>;
  testID?: string;
}) {
  return (
    <Text
      style={style}
      testID={testID}
      accessibilityLabel={value}
      maxFontSizeMultiplier={1.4}
      numberOfLines={1}
      adjustsFontSizeToFit
    >
      {value}
    </Text>
  );
}

// Stable keys let surviving rows move into the spaces vacated by filtered rows.
export function MotionRow({
  children,
  style,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const reduced = useReducedMotion();
  return (
    <Animated.View
      collapsable={false}
      style={style}
      layout={reduced ? undefined : LinearTransition.duration(180)}
    >
      {children}
    </Animated.View>
  );
}

export function ChartScrubber({
  count,
  selectedIndex,
  onSelect,
  children,
  style,
  label,
  testID,
}: PropsWithChildren<{
  count: number;
  selectedIndex: number;
  onSelect: (index: number) => void;
  style?: StyleProp<ViewStyle>;
  label: string;
  testID?: string;
}>) {
  const width = useSharedValue(1);
  const lastIndex = useSharedValue(selectedIndex);
  useEffect(() => {
    lastIndex.value = selectedIndex;
  }, [lastIndex, selectedIndex]);
  const pan = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .failOffsetY([-10, 10])
    .onStart((event) => {
      const index = chartIndexAtPosition(event.x, width.value, count);
      if (index >= 0) {
        lastIndex.value = index;
        runOnJS(onSelect)(index);
      }
    })
    .onUpdate((event) => {
      const index = chartIndexAtPosition(event.x, width.value, count);
      if (index >= 0 && index !== lastIndex.value) {
        lastIndex.value = index;
        runOnJS(onSelect)(index);
      }
    });
  return (
    <GestureDetector gesture={pan}>
      <View
        style={style}
        testID={testID}
        onLayout={(event) => {
          width.value = event.nativeEvent.layout.width;
        }}
        accessibilityLabel={label}
        accessibilityRole="adjustable"
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => {
          const next = selectedIndex + (event.nativeEvent.actionName === 'increment' ? 1 : -1);
          if (next >= 0 && next < count) onSelect(next);
        }}
      >
        {children}
      </View>
    </GestureDetector>
  );
}

// Only the summary owns month swipes; chart drags and native edge-back stay independent.
export function MonthSwipe({
  month,
  months,
  onSelect,
  children,
  style,
  testID,
}: PropsWithChildren<{
  month: string;
  months: string[];
  onSelect: (month: string) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>) {
  const { language } = useLanguage();
  const reduced = useReducedMotion();
  const width = useSharedValue(1);
  const drag = useSharedValue(0);
  const select = (translation: number) => {
    const next = adjacentMonth(month, months, translation, language === 'he');
    if (next) onSelect(next);
  };
  const pan = Gesture.Pan()
    .activeOffsetX([-24, 24])
    .failOffsetY([-12, 12])
    .onTouchesDown((event, manager) => {
      const x = event.allTouches[0]?.x ?? 0;
      if (x < 24 || x > width.value - 24) manager.fail();
    })
    .onUpdate((event) => {
      if (!reduced) drag.value = Math.max(-64, Math.min(64, event.translationX * 0.45));
    })
    .onEnd((event) => {
      if (Math.abs(event.translationX) > 52 || Math.abs(event.velocityX) > 600)
        runOnJS(select)(event.translationX);
    })
    .onFinalize(() => {
      drag.value = reduced ? 0 : withSpring(0, { damping: 22, stiffness: 240 });
    });
  const animated = useAnimatedStyle(() => ({ transform: [{ translateX: drag.value }] }));
  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        testID={testID}
        onLayout={(event) => {
          width.value = event.nativeEvent.layout.width;
        }}
        style={[style, animated]}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  );
}
