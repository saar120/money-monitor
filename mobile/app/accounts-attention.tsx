import { Text } from '@/LocalizedText';
import { t } from '@/localization';
import { Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { ScrollView, StyleSheet, View } from 'react-native';
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
      <Stack.Screen options={{ title: t('accounts'), headerBackTitle: t('home') }} />
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: colors.background }}
        testID="account-attention-screen"
      >
        <Text style={[styles.title, { color: colors.text }]}>{t('refreshOnYourMac')}</Text>
        <View style={[styles.list, { backgroundColor: colors.surface }]}>
          {accounts.map((account, index) => (
            <View
              key={account.account}
              style={[
                styles.row,
                {
                  borderBottomColor: colors.separator,
                  borderBottomWidth: index === accounts.length - 1 ? 0 : StyleSheet.hairlineWidth,
                },
              ]}
            >
              <SymbolView name="exclamationmark.circle.fill" size={18} tintColor={colors.danger} />
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
  content: { paddingHorizontal: 20, paddingBottom: 72 },
  title: { marginTop: 12, fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: -0.5 },
  list: { marginTop: 24, borderRadius: 16, paddingHorizontal: 14, overflow: 'hidden' },
  row: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  copy: { flex: 1, minWidth: 0, paddingVertical: 12 },
  account: { fontSize: 16, lineHeight: 21, fontWeight: '600' },
  detail: { marginTop: 3, fontSize: 13, lineHeight: 18 },
});
