import 'react-native-gesture-handler';
import * as ScreenCapture from 'expo-screen-capture';
import * as SecureStore from 'expo-secure-store';
import {
  DarkTheme,
  DefaultTheme,
  Stack,
  ThemeProvider,
  useGlobalSearchParams,
  usePathname,
} from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Settings, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthGate } from '@/security/AuthGate';
import { selectFixtureScenario } from '@/fixture-selection';
import { MoneyDataProvider } from '@/MoneyData';
import { LAST_ROOT_TAB_KEY, rootTabFromPath } from '@/navigation-state';
import { useAppColors } from '@/theme';
import { LanguageProvider, t, useLanguage } from '@/localization';

export default function RootLayout() {
  return (
    <LanguageProvider>
      <AppLayout />
    </LanguageProvider>
  );
}

function AppLayout() {
  const colors = useAppColors();
  const { language } = useLanguage();
  const baseNavigationTheme = useColorScheme() === 'dark' ? DarkTheme : DefaultTheme;
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
    <GestureHandlerRootView
      style={{
        flex: 1,
        backgroundColor: colors.background,
        direction: language === 'he' ? 'rtl' : 'ltr',
      }}
    >
      <StatusBar style="auto" />
      <ThemeProvider
        value={{
          ...baseNavigationTheme,
          colors: {
            ...baseNavigationTheme.colors,
            background: colors.background,
            border: colors.separator,
            card: colors.background,
            notification: colors.danger,
            primary: colors.accent,
            text: colors.text,
          },
        }}
      >
        <AuthGate previewLocked={previewLocked}>
          <MoneyDataProvider>
            <NavigationPersistence />
            <Stack
              screenOptions={{
                contentStyle: { backgroundColor: colors.background },
                headerBackButtonDisplayMode: 'minimal',
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
              <Stack.Screen name="foundation" options={{ title: t('foundationChecks') }} />
              <Stack.Screen name="review" options={{ title: t('review') }} />
              <Stack.Screen name="category/[name]" options={{ title: t('category') }} />
              <Stack.Screen name="merchant/[name]" options={{ title: t('merchant') }} />
              <Stack.Screen name="transaction/[id]" options={{ title: t('transaction') }} />
              <Stack.Screen name="net-worth" options={{ title: t('netWorth') }} />
              <Stack.Screen name="settings" options={{ title: t('settings') }} />
              <Stack.Screen
                name="accounts-attention"
                options={{ title: t('accounts'), headerBackTitle: t('home') }}
              />
            </Stack>
          </MoneyDataProvider>
        </AuthGate>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

function NavigationPersistence() {
  const pathname = usePathname();

  useEffect(() => {
    const tab = rootTabFromPath(pathname);
    if (tab) void SecureStore.setItemAsync(LAST_ROOT_TAB_KEY, tab).catch(() => undefined);
  }, [pathname]);

  return null;
}
