import { Stack } from 'expo-router';
import { useAppColors } from '@/theme';
import { t, useLanguage } from '@/localization';

export default function ExploreLayout() {
  const colors = useAppColors();
  const { language } = useLanguage();
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
        options={{
          title: t('explore'),
          headerLargeTitleEnabled: false,
          headerTitleAlign: language === 'he' ? 'center' : 'left',
        }}
      />
      <Stack.Screen name="categories" options={{ title: t('categories') }} />
      <Stack.Screen name="monthly-comparison" options={{ title: t('monthlySpending') }} />
      <Stack.Screen name="budgets" options={{ title: t('budgets') }} />
      <Stack.Screen name="cash-flow" options={{ title: t('cashFlow') }} />
      <Stack.Screen name="category/[name]" options={{ title: t('category') }} />
      <Stack.Screen name="merchant/[name]" options={{ title: t('merchant') }} />
      <Stack.Screen name="net-worth" options={{ title: t('netWorth') }} />
    </Stack>
  );
}
