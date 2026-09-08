import { Stack } from 'expo-router';
import { useAppColors } from '@/theme';

export default function PlanLayout() {
  const colors = useAppColors();
  return (
    <Stack screenOptions={{ headerLargeTitleEnabled: false, headerShadowVisible: false, headerStyle: { backgroundColor: colors.background }, headerTitleStyle: { color: colors.text }, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="index" options={{ title: 'Plan', headerTitleAlign: 'left' }} />
    </Stack>
  );
}
