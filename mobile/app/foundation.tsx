import { t } from '@/localization';
import { Text } from '@/LocalizedText';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  deletePairingCredential,
  readPairingCredential,
  storePairingCredential,
} from '@/security/pairing-credential-store';
import { useAppColors } from '@/theme';

const dummyCredential = {
  serverId: '11111111-1111-4111-8111-111111111111',
  baseURL: 'https://money-monitor.example.ts.net/money-monitor',
  token: 'D'.repeat(43),
};

export default function FoundationScreen() {
  const colors = useAppColors();
  const [status, setStatus] = useState(t('readyNoCredentialOperationHasRun'));

  async function perform(operation: 'store' | 'read' | 'delete') {
    try {
      if (operation === 'store') {
        await storePairingCredential(dummyCredential);
        setStatus(t('dummyPairingCredentialStoredInTheIOSKeychain'));
      } else if (operation === 'read') {
        const credential = await readPairingCredential();
        setStatus(
          credential
            ? t('readCredentialFor', { id: credential.serverId.slice(0, 8) })
            : t('noPairingCredentialIsStored'),
        );
      } else {
        await deletePairingCredential();
        setStatus(t('pairingCredentialDeleted'));
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t('theCredentialOperationFailed'));
    }
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.statusArea, { borderBottomColor: colors.separator }]}>
        <SymbolView name="key.icloud.fill" size={37} tintColor={colors.accent} />
        <Text style={[styles.title, { color: colors.text }]}>{t('secureCredentialStorage')}</Text>
        <Text style={[styles.explanation, { color: colors.secondary }]}>
          {t(
            'thisExercisesTheExactStoreReadAndDeleteOperationsReservedForAFuturePairingCredential',
          )}
        </Text>
      </View>
      <Text style={[styles.status, { color: colors.text }]} testID="secure-store-status">
        {status}
      </Text>
      <View style={styles.buttons}>
        <FoundationButton label={t('storeDummyCredential')} onPress={() => void perform('store')} />
        <FoundationButton label={t('readCredential')} onPress={() => void perform('read')} />
        <FoundationButton
          label={t('deleteCredential')}
          destructive
          onPress={() => void perform('delete')}
        />
      </View>
    </View>
  );
}

function FoundationButton({
  label,
  onPress,
  destructive = false,
}: {
  label: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  const colors = useAppColors();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { borderBottomColor: colors.separator, opacity: pressed ? 0.62 : 1 },
      ]}
    >
      <Text style={[styles.buttonLabel, { color: destructive ? colors.danger : colors.accent }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 20 },
  statusArea: {
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 44,
    paddingBottom: 34,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { marginTop: 18, fontSize: 23, fontWeight: '700' },
  explanation: { marginTop: 8, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  status: { minHeight: 74, paddingVertical: 22, fontSize: 15, lineHeight: 21 },
  buttons: { borderTopWidth: StyleSheet.hairlineWidth },
  button: { minHeight: 54, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  buttonLabel: { fontSize: 17, fontWeight: '600' },
});
