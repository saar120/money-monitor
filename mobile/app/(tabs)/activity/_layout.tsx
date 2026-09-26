import { Stack } from 'expo-router';
import { useAppColors } from '@/theme';
import { t, useLanguage } from '@/localization';

export default function ActivityLayout() {
  const colors = useAppColors();
  const { language } = useLanguage();
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
      <Stack.Screen
        name="index"
        options={{
          title: t('activity'),
          headerLargeTitleEnabled: false,
          headerTitleAlign: language === 'he' ? 'center' : 'left',
        }}
      />
      <Stack.Screen
        name="[id]"
        options={{ title: t('transaction'), headerLargeTitleEnabled: false }}
      />
    </Stack>
  );
}
