import { Stack } from 'expo-router';
import { useAppColors } from '@/theme';

export default function ExploreLayout() {
  const colors = useAppColors();
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        headerLargeStyle: { backgroundColor: colors.background },
        headerLargeTitleStyle: { color: colors.text },
        headerTitleStyle: { color: colors.text },
        headerTintColor: colors.accent,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Explore', headerTitleAlign: 'left' }} />
      <Stack.Screen name="category/[name]" options={{ title: 'Category' }} />
      <Stack.Screen name="merchant/[name]" options={{ title: 'Merchant' }} />
      <Stack.Screen name="net-worth" options={{ title: 'Net worth' }} />
    </Stack>
  );
}
