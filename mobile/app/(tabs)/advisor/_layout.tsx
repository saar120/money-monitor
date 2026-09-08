import { Stack } from 'expo-router';
import { useAppColors } from '@/theme';

export default function AdvisorLayout() {
  const colors = useAppColors();
  return (
    <Stack screenOptions={{ headerLargeTitleEnabled: false, headerShadowVisible: false, headerStyle: { backgroundColor: colors.background }, headerTitleStyle: { color: colors.text }, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="index" options={{ title: 'Advisor', headerTitleAlign: 'left' }} />
    </Stack>
  );
}
