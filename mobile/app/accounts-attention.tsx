import { Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ConnectionState } from '@/ConnectionState';
import { useMoneyData } from '@/MoneyData';
import { useAppColors } from '@/theme';

export default function AccountsAttentionScreen() {
  const colors = useAppColors();
  const { home, status } = useMoneyData();
  if (status !== 'ready' || !home) return <ConnectionState />;

  const accounts = home.freshness.filter((account) => account.state === 'stale');

  return (
    <>
      <Stack.Screen options={{ title: 'Accounts', headerBackTitle: 'Home' }} />
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: colors.background }}
        testID="account-attention-screen"
      >
        <Text style={[styles.title, { color: colors.text }]}>Refresh on your Mac</Text>
        <Text style={[styles.intro, { color: colors.secondary }]}>
          These sources need attention before their balances are current.
        </Text>
        <View style={styles.list}>
          {accounts.map((account) => (
            <View
              key={account.account}
              style={[styles.row, { borderBottomColor: colors.separator }]}
            >
              <SymbolView
                name="exclamationmark.circle.fill"
                size={18}
                tintColor={colors.danger}
              />
              <View style={styles.copy}>
                <Text style={[styles.account, { color: colors.text }]}>{account.account}</Text>
                <Text style={[styles.detail, { color: colors.secondary }]}>{account.detail}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 48 },
  title: { marginTop: 12, fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: -0.5 },
  intro: { marginTop: 8, fontSize: 15, lineHeight: 21 },
  list: { marginTop: 24 },
  row: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  copy: { flex: 1, paddingVertical: 12 },
  account: { fontSize: 16, lineHeight: 21, fontWeight: '600', writingDirection: 'ltr' },
  detail: { marginTop: 3, fontSize: 13, lineHeight: 18 },
});
