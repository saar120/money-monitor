import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useMoneyData } from './MoneyData';
import { useAppColors } from './theme';

export function ConnectionState() {
  const colors = useAppColors();
  const { status, error, reload } = useMoneyData();
  const loading = status === 'loading';
  const unpaired = status === 'unpaired';

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
          ? 'Loading from your Mac'
          : unpaired
            ? 'Connect your Mac'
            : 'Couldn’t load your finances'}
      </Text>
      <Text style={[styles.body, { color: colors.secondary }]}>
        {loading
          ? 'Money Monitor is reading the latest private snapshot.'
          : unpaired
            ? 'Scan the pairing code in Money Monitor settings. Your data and calculations stay on the Mac.'
            : (error ?? 'Check that Money Monitor and Tailscale are running on your Mac.')}
      </Text>
      {!loading ? (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/scanner')}
            style={({ pressed }) => [
              styles.primary,
              { backgroundColor: colors.accent, opacity: pressed ? 0.72 : 1 },
            ]}
          >
            <Text style={styles.primaryLabel}>{unpaired ? 'Scan pairing code' : 'Pair again'}</Text>
          </Pressable>
          {!unpaired ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => void reload()}
              style={styles.secondary}
            >
              <Text style={[styles.secondaryLabel, { color: colors.accent }]}>Try again</Text>
            </Pressable>
          ) : null}
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
  primaryLabel: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  secondary: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  secondaryLabel: { fontSize: 16, fontWeight: '600' },
});
