import { t } from './localization';
import { Text } from './LocalizedText';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useMoneyData } from './MoneyData';
import { useAppColors } from './theme';

export function ConnectionState({
  error,
  onRetry,
}: { error?: string | null; onRetry?: () => void } = {}) {
  const colors = useAppColors();
  const { status, reload, availability } = useMoneyData();
  const loading = status === 'loading';
  const unpaired = status === 'unpaired';
  const saved = availability === 'saved-view' || availability === 'stale-saved-view';

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]} testID="live-data-state">
      {loading ? (
        <ActivityIndicator color={colors.accent} size="large" />
      ) : (
        <View style={[styles.icon, { backgroundColor: colors.accentSoft }]}>
          <SymbolView
            name={
              unpaired
                ? 'macbook.and.iphone'
                : 'exclamationmark.arrow.trianglehead.2.clockwise.rotate.90'
            }
            size={34}
            tintColor={unpaired ? colors.accent : colors.warning}
          />
        </View>
      )}
      <Text style={[styles.title, { color: colors.text }]}>
        {loading
          ? t('loadingFromYourMac')
          : unpaired
            ? t('connectYourMac')
            : saved
              ? t('savedView')
              : t('couldnTLoadYourFinances')}
      </Text>
      <Text style={[styles.body, { color: colors.secondary }]}>
        {error ??
          (loading
            ? t('moneyMonitorIsReadingTheLatestPrivateSnapshot')
            : unpaired
              ? t('scanThePairingCodeInMoneyMonitorSettingsYourDataAndCalculationsStayOnTheMac')
              : saved
                ? t('savedViewUnavailable')
                : t('checkThatMoneyMonitorAndTailscaleAreRunningOnYourMac'))}
      </Text>
      {!loading ? (
        <View style={styles.actions}>
          {/* A failed load usually just needs a retry; re-pairing is the fallback. */}
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              onRetry ? onRetry() : unpaired ? router.push('/scanner') : void reload()
            }
            style={({ pressed }) => [
              styles.primary,
              { backgroundColor: colors.accent, opacity: pressed ? 0.72 : 1 },
            ]}
          >
            <Text style={[styles.primaryLabel, { color: colors.onAccent }]}>
              {unpaired ? t('scanPairingCode') : t('tryAgain')}
            </Text>
          </Pressable>
          {!unpaired ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/scanner')}
              style={styles.secondary}
            >
              <Text style={[styles.secondaryLabel, { color: colors.accent }]}>
                {t('pairAgain')}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/settings')}
            style={styles.secondary}
          >
            <Text style={[styles.secondaryLabel, { color: colors.accent }]}>{t('settings')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 34 },
  icon: { width: 70, height: 70, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  title: { marginTop: 22, fontSize: 24, lineHeight: 30, fontWeight: '700', textAlign: 'center' },
  body: { marginTop: 10, fontSize: 16, lineHeight: 23, textAlign: 'center' },
  actions: { width: '100%', maxWidth: 300, marginTop: 27 },
  primary: { minHeight: 50, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  primaryLabel: { fontSize: 17, fontWeight: '600' },
  secondary: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  secondaryLabel: { fontSize: 16, fontWeight: '600' },
});
