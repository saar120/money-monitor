import 'react-native-gesture-handler';
import * as ScreenCapture from 'expo-screen-capture';
import { Stack, useGlobalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Settings } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthGate } from '@/security/AuthGate';
import { selectFixtureScenario } from '@/fixture-selection';
import { MoneyDataProvider } from '@/MoneyData';
import { useAppColors } from '@/theme';

export default function RootLayout() {
  const colors = useAppColors();
  const params = useGlobalSearchParams<{ fixture?: string; auth?: string }>();
  const previewLocked =
    (__DEV__ && params.auth === 'preview') || Settings.get('MM_AUTH_PREVIEW') === 'locked';
  selectFixtureScenario(__DEV__ ? params.fixture : undefined);

  useEffect(() => {
    void ScreenCapture.enableAppSwitcherProtectionAsync(1);
    return () => {
      void ScreenCapture.disableAppSwitcherProtectionAsync();
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar style="auto" />
      <AuthGate previewLocked={previewLocked}>
        <MoneyDataProvider>
          <Stack
            screenOptions={{
              contentStyle: { backgroundColor: colors.background },
              headerStyle: { backgroundColor: colors.background },
              headerTintColor: colors.accent,
              headerShadowVisible: false,
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="scanner"
              options={{ headerShown: false, presentation: 'fullScreenModal' }}
            />
            <Stack.Screen name="foundation" options={{ title: 'Foundation checks' }} />
            <Stack.Screen name="review" options={{ title: 'Review' }} />
          </Stack>
        </MoneyDataProvider>
      </AuthGate>
    </GestureHandlerRootView>
  );
}
