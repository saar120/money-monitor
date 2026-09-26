import { t } from '../localization';
import { Text } from '../LocalizedText';
import * as Device from 'expo-device';
import * as LocalAuthentication from 'expo-local-authentication';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useAppColors } from '@/theme';

type GateState = 'checking' | 'locked' | 'setup-required' | 'unlocked';

export function AuthGate({
  children,
  previewLocked = false,
}: {
  children: ReactNode;
  previewLocked?: boolean;
}) {
  const colors = useAppColors();
  const [state, setState] = useState<GateState>(previewLocked ? 'locked' : 'checking');
  const [hasUnlocked, setHasUnlocked] = useState(false);
  const [message, setMessage] = useState(t('financialInformationStaysHiddenUntilYouUnlock'));
  const needsAuthenticationAfterBackground = useRef(false);

  const authenticate = useCallback(async () => {
    if (previewLocked) return;
    const [hardware, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    // Simulators cannot authenticate; production hardware must never bypass the gate.
    if (!Device.isDevice) {
      setHasUnlocked(true);
      setState('unlocked');
      return;
    }

    if (!hardware || !enrolled) {
      setState('setup-required');
      setMessage(t('setUpFaceIDOrDeviceAuthenticationInIPhoneSettingsToUnlockMoneyMonitor'));
      return;
    }

    setState('locked');
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: t('unlockMoneyMonitor'),
      cancelLabel: t('keepLocked'),
      fallbackLabel: t('useDevicePasscode'),
      disableDeviceFallback: false,
    });
    if (result.success) {
      setHasUnlocked(true);
      setState('unlocked');
      setMessage(t('financialInformationStaysHiddenUntilYouUnlock'));
    } else {
      setMessage(t('moneyMonitorIsStillLockedTryAgainWhenYouAreReady'));
    }
  }, [previewLocked]);

  useEffect(() => {
    void authenticate();
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background') {
        needsAuthenticationAfterBackground.current = true;
        setState('locked');
      }
      if (nextState === 'active' && needsAuthenticationAfterBackground.current) {
        needsAuthenticationAfterBackground.current = false;
        void authenticate();
      }
    });
    return () => subscription.remove();
  }, [authenticate]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {hasUnlocked ? (
        <View
          accessibilityElementsHidden={state !== 'unlocked'}
          importantForAccessibility={state === 'unlocked' ? 'auto' : 'no-hide-descendants'}
          pointerEvents={state === 'unlocked' ? 'auto' : 'none'}
          style={[styles.content, state !== 'unlocked' && styles.hiddenContent]}
        >
          {children}
        </View>
      ) : null}
      {state !== 'unlocked' ? (
        <View style={[styles.screen, { backgroundColor: colors.background }]} testID="auth-gate">
          <View style={[styles.iconWell, { backgroundColor: colors.accentSoft }]}>
            <SymbolView name="lock.shield.fill" size={34} tintColor={colors.accent} />
          </View>
          <Text style={[styles.title, { color: colors.text }]}>{t('moneyMonitorIsLocked')}</Text>
          <Text style={[styles.message, { color: colors.secondary }]}>{message}</Text>
          {state === 'locked' && !previewLocked ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('unlockMoneyMonitor')}
              onPress={() => void authenticate()}
              style={({ pressed }) => [
                styles.unlockButton,
                { backgroundColor: colors.accent, opacity: pressed ? 0.72 : 1 },
              ]}
            >
              <SymbolView name="faceid" size={20} tintColor="#FFFFFF" />
              <Text style={styles.unlockLabel}>{t('unlock')}</Text>
            </Pressable>
          ) : null}
          {state === 'setup-required' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('openIPhoneSettings')}
              onPress={() => void Linking.openSettings()}
              style={({ pressed }) => [
                styles.unlockButton,
                { backgroundColor: colors.accent, opacity: pressed ? 0.72 : 1 },
              ]}
            >
              <SymbolView name="gearshape.fill" size={19} tintColor="#FFFFFF" />
              <Text style={styles.unlockLabel}>{t('openSettings')}</Text>
            </Pressable>
          ) : null}
          <Text style={[styles.privacyNote, { color: colors.tertiary }]}>
            {t('protectedOnThisIPhone')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1 },
  hiddenContent: { opacity: 0 },
  screen: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
  },
  iconWell: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    letterSpacing: -0.6,
    textAlign: 'center',
  },
  message: { marginTop: 12, fontSize: 17, lineHeight: 24, textAlign: 'center' },
  unlockButton: {
    minWidth: 164,
    minHeight: 50,
    marginTop: 30,
    borderRadius: 13,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  unlockLabel: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  privacyNote: { position: 'absolute', bottom: 44, fontSize: 13 },
});
