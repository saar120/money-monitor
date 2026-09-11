import { Stack } from 'expo-router';
import { useAppColors } from '@/theme';

export default function HomeLayout() {
  const colors = useAppColors();
  return (
    <Stack
      screenOptions={{
        headerLargeTitleEnabled: false,
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        headerLargeStyle: { backgroundColor: colors.background },
        headerLargeTitleStyle: { color: colors.text },
        headerTitleStyle: { color: colors.text },
        headerTintColor: colors.accent,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
    </Stack>
  );
}
