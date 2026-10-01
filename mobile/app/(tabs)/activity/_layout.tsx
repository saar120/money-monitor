import { Stack } from 'expo-router';
import { useAppColors } from '@/theme';
import { t } from '@/localization';

export default function ActivityLayout() {
  const colors = useAppColors();
  return (
    <Stack
      screenOptions={{
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
      <Stack.Screen
        name="[id]"
        options={{ title: t('transaction'), headerLargeTitleEnabled: false }}
      />
    </Stack>
  );
}
