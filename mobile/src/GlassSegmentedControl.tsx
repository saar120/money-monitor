import { GlassView } from 'expo-glass-effect';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, useColorScheme } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useAppColors } from './theme';

const AnimatedGlassView = Animated.createAnimatedComponent(GlassView);

export function GlassSegmentedControl<T extends string>({
  onChange,
  options,
  testID,
  value,
}: {
  onChange: (value: T) => void;
  options: ReadonlyArray<{ label: string; value: T }>;
  testID?: string;
  value: T;
}) {
  const colors = useAppColors();
  const colorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const reduceMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const index = useSharedValue(selectedIndex);
  const lensWidth = width > 0 ? (width - 8) / options.length : 0;

  useEffect(() => {
    index.value = reduceMotion
      ? selectedIndex
      : withSpring(selectedIndex, { stiffness: 300, damping: 28, mass: 0.82 });
  }, [index, reduceMotion, selectedIndex]);

  const lensStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: index.value * lensWidth }],
  }));

  return (
    <GlassView
      colorScheme={colorScheme}
      glassEffectStyle="regular"
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={[
        styles.control,
        {
          backgroundColor: colors.glass,
          borderColor: colors.glassBorder,
          shadowColor: colors.glassShadow,
        },
      ]}
      testID={testID}
    >
      {width ? (
        <AnimatedGlassView
          colorScheme={colorScheme}
          glassEffectStyle="clear"
          pointerEvents="none"
          style={[
            styles.lens,
            {
              width: lensWidth,
              backgroundColor: colors.surface,
              borderColor: colors.glassHighlight,
            },
            lensStyle,
          ]}
        />
      ) : null}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [styles.button, { opacity: pressed ? 0.64 : 1 }]}
          >
            <Text style={[styles.label, { color: selected ? colors.text : colors.secondary }]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </GlassView>
  );
}

const styles = StyleSheet.create({
  control: {
    height: 43,
    padding: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    flexDirection: 'row',
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
  },
  lens: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
  },
  button: { zIndex: 1, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  label: { fontSize: 13, fontWeight: '700' },
});
