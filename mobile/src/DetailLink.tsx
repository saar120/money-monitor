import { router, type Href } from 'expo-router';
import { Pressable, type PressableProps } from 'react-native';

// Keep Pressable's style callback intact; Link's slot merges styles as plain objects.
export function DetailLink({
  href,
  onPress,
  ...props
}: PressableProps & { href: Href; accessibilityLabel: string }) {
  return (
    <Pressable
      {...props}
      accessibilityRole="button"
      onPress={(event) => {
        onPress?.(event);
        if (!event.defaultPrevented) router.push(href);
      }}
    />
  );
}
