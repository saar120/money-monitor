import { SymbolView } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';
import { useAppColors } from '@/theme';

export default function PlanScreen() {
  const colors = useAppColors();
  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]} testID="plan-placeholder">
      <View style={[styles.symbol, { backgroundColor: colors.blueSoft }]}>
        <SymbolView name="chart.pie.fill" size={30} tintColor={colors.blue} />
      </View>
      <Text style={[styles.title, { color: colors.text }]}>Build the next month before it begins</Text>
      <Text style={[styles.body, { color: colors.secondary }]}>Budgets, net worth goals, and assets will live here once the iPhone reads real planning data from the Mac.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 34, paddingBottom: 80 },
  symbol: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.4, textAlign: 'center' },
  body: { marginTop: 11, fontSize: 16, lineHeight: 23, textAlign: 'center' },
});
