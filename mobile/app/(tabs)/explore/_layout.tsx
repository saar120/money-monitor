import { Stack } from 'expo-router';
import { useAppColors } from '@/theme';
import { t } from '@/localization';

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
        headerTitle: '',
        headerTintColor: colors.accent,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen name="categories" options={{ title: t('categories') }} />
      <Stack.Screen name="monthly-comparison" options={{ title: t('monthlySpending') }} />
      <Stack.Screen name="budgets" options={{ title: t('budgets') }} />
      <Stack.Screen name="cash-flow" options={{ title: t('cashFlow') }} />
      <Stack.Screen name="recurring-payments" options={{ title: t('subscriptions') }} />
      <Stack.Screen name="recurring-payment-detail" options={{ title: t('subscriptionDetails') }} />
      <Stack.Screen name="category/[name]" options={{ title: '' }} />
      <Stack.Screen
        name="merchant/[name]"
        options={({ route }) => ({
          title: (route.params as { name?: string } | undefined)?.name ?? t('merchant'),
        })}
      />
      <Stack.Screen name="net-worth" options={{ title: t('netWorth') }} />
    </Stack>
  );
}
