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
import { Settings, useColorScheme, View, Pressable } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthGate } from '@/security/AuthGate';
import { selectFixtureScenario } from '@/fixture-selection';
import { Text } from '@/LocalizedText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MoneyDataProvider, useMoneyData } from '@/MoneyData';
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
            <SavedViewNotice />
            <NavigationPersistence />
            <Stack
              screenOptions={{
                contentStyle: { backgroundColor: colors.background },
                headerBackButtonDisplayMode: 'minimal',
                headerStyle: { backgroundColor: colors.background },
                headerTitle: '',
                headerTintColor: colors.accent,
                headerShadowVisible: false,
              }}
            >
              <Stack.Screen name="index" options={{ headerShown: false }} />
              {/* The launch redirect replaces index with the tabs; without this they slide in sideways. */}
              <Stack.Screen name="(tabs)" options={{ animation: 'none', headerShown: false }} />
              <Stack.Screen
                name="scanner"
                options={{ headerShown: false, presentation: 'fullScreenModal' }}
              />
              <Stack.Screen name="foundation" options={{ title: t('foundationChecks') }} />
              <Stack.Screen name="review" options={{ title: t('review') }} />
              <Stack.Screen name="category/[name]" options={{ title: '' }} />
              <Stack.Screen
                name="merchant/[name]"
                options={({ route }) => ({
                  title: (route.params as { name?: string } | undefined)?.name ?? t('merchant'),
                })}
              />
              <Stack.Screen name="transaction/[id]" options={{ title: t('transaction') }} />
              <Stack.Screen name="net-worth" options={{ title: t('netWorth') }} />
              <Stack.Screen name="budgets" options={{ title: t('budgets') }} />
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

function SavedViewNotice() {
  const { availability, reload } = useMoneyData();
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  if (availability !== 'saved-view' && availability !== 'stale-saved-view') return null;
  return (
    <View
      accessibilityRole="alert"
      style={{
        paddingTop: insets.top,
        backgroundColor: colors.surface,
        paddingHorizontal: 20,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <Text
        style={{
          color: availability === 'stale-saved-view' ? colors.warning : colors.secondary,
          paddingVertical: 12,
        }}
      >
        {t(availability === 'stale-saved-view' ? 'staleSavedView' : 'savedView')}
      </Text>
      <Pressable accessibilityRole="button" onPress={() => void reload()} style={{ padding: 12 }}>
        <Text style={{ color: colors.accent }}>{t('tryAgain')}</Text>
      </Pressable>
    </View>
  );
}
