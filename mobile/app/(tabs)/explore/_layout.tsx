import { Stack } from 'expo-router';
import { useAppColors } from '@/theme';

export default function ExploreLayout() {
  const colors = useAppColors();
  return (
    <Stack
      screenOptions={{
        headerBackButtonDisplayMode: 'minimal',
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        headerLargeStyle: { backgroundColor: colors.background },
        headerLargeTitleStyle: { color: colors.text },
        headerTitleStyle: { color: colors.text },
        headerTintColor: colors.accent,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen
        name="index"
        options={{ title: 'Explore', headerLargeTitleEnabled: false, headerTitleAlign: 'left' }}
      />
      <Stack.Screen name="categories" options={{ title: 'Categories' }} />
      <Stack.Screen name="monthly-comparison" options={{ title: 'Monthly spending' }} />
      <Stack.Screen name="budgets" options={{ title: 'Budgets' }} />
      <Stack.Screen name="cash-flow" options={{ title: 'Cash flow' }} />
      <Stack.Screen name="category/[name]" options={{ title: 'Category' }} />
      <Stack.Screen name="merchant/[name]" options={{ title: 'Merchant' }} />
      <Stack.Screen name="net-worth" options={{ title: 'Net worth' }} />
    </Stack>
  );
}
