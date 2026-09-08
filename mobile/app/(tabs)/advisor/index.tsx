import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppColors } from '@/theme';

export default function AdvisorScreen() {
  const colors = useAppColors();
  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]} testID="advisor-placeholder">
      <View style={styles.intro}>
        <View style={[styles.symbol, { backgroundColor: colors.accentSoft }]}>
          <SymbolView name="sparkles" size={30} tintColor={colors.accent} />
        </View>
        <Text style={[styles.title, { color: colors.text }]}>Private advice, grounded in your finances</Text>
        <Text style={[styles.body, { color: colors.secondary }]}>Advisor will run on the Mac. The iPhone will be a focused place to read, ask, and act.</Text>
      </View>

      <View style={[styles.actions, { borderTopColor: colors.separator }]}>
        <Action
          label="Connect to your Mac"
          detail="Scan the real Money Monitor pairing code"
          symbol="qrcode.viewfinder"
          onPress={() => router.push('/scanner')}
        />
        <Action
          label="Foundation checks"
          detail="Exercise secure credential storage"
          symbol="checkmark.shield"
          onPress={() => router.push('/foundation')}
        />
      </View>
    </View>
  );
}

function Action({ label, detail, symbol, onPress }: { label: string; detail: string; symbol: Parameters<typeof SymbolView>[0]['name']; onPress: () => void }) {
  const colors = useAppColors();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.action, { borderBottomColor: colors.separator, opacity: pressed ? 0.62 : 1 }]}
    >
      <SymbolView name={symbol} size={23} tintColor={colors.accent} style={styles.actionIcon} />
      <View style={styles.actionCopy}>
        <Text style={[styles.actionLabel, { color: colors.text }]}>{label}</Text>
        <Text style={[styles.actionDetail, { color: colors.secondary }]}>{detail}</Text>
      </View>
      <SymbolView name="chevron.right" size={14} tintColor={colors.tertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 20 },
  intro: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, paddingBottom: 10 },
  symbol: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.4, textAlign: 'center' },
  body: { marginTop: 11, fontSize: 16, lineHeight: 23, textAlign: 'center' },
  actions: { borderTopWidth: StyleSheet.hairlineWidth, paddingBottom: 24 },
  action: { minHeight: 68, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  actionIcon: { width: 34, marginRight: 9 },
  actionCopy: { flex: 1 },
  actionLabel: { fontSize: 16, fontWeight: '600' },
  actionDetail: { fontSize: 12.5, marginTop: 3 },
});
