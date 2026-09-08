import { Stack } from 'expo-router';
import { useAppColors } from '@/theme';

export default function ActivityLayout() {
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
      <Stack.Screen name="index" options={{ title: 'Activity', headerLargeTitleEnabled: false, headerTitleAlign: 'left' }} />
      <Stack.Screen name="[id]" options={{ title: 'Transaction', headerLargeTitleEnabled: false }} />
    </Stack>
  );
}
