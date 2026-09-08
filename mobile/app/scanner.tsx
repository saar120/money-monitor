import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Device from 'expo-device';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMoneyData } from '@/MoneyData';
import { completePairing, type PairingProgress } from '@/mobile-api';
import { checkMobileHealth, type MobileHealthResult } from '@/pairing/check-mobile-health';
import { parsePairingQr, type PairingQrPayload } from '@/pairing/parse-pairing-qr';
import { storePairingCredential } from '@/security/pairing-credential-store';
import { useAppColors } from '@/theme';

type ScanState =
  | { kind: 'scanning' }
  | { kind: 'working'; pairing: PairingQrPayload; progress: 'checking' | PairingProgress }
  | {
      kind: 'result';
      pairing?: PairingQrPayload;
      health?: MobileHealthResult;
      connected?: boolean;
      error?: string;
    };

export default function ScannerScreen() {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [state, setState] = useState<ScanState>({ kind: 'scanning' });
  const pairingController = useRef<AbortController | null>(null);
  const { reload } = useMoneyData();

  useEffect(() => () => pairingController.current?.abort(), []);

  useEffect(() => {
    if (state.kind !== 'result') return;
    const message = state.connected ? 'Connected to Mac' : 'Could not connect to Mac';
    AccessibilityInfo.announceForAccessibility(message);
  }, [state]);

  async function onScanned(result: BarcodeScanningResult) {
    if (state.kind !== 'scanning') return;
    try {
      const pairing = parsePairingQr(result.data);
      setState({ kind: 'working', pairing, progress: 'checking' });
      const health = await checkMobileHealth(pairing);
      if (!health.reachable) {
        setState({ kind: 'result', pairing, health });
        return;
      }
      const controller = new AbortController();
      pairingController.current = controller;
      const credential = await completePairing(
        pairing,
        Device.deviceName ?? Device.modelName ?? 'iPhone',
        (progress) => setState({ kind: 'working', pairing, progress }),
        controller.signal,
      );
      await storePairingCredential(credential);
      await reload();
      setState({ kind: 'result', pairing, health, connected: true });
    } catch (error) {
      if (pairingController.current?.signal.aborted) return;
      setState({
        kind: 'result',
        error: error instanceof Error ? error.message : 'The QR code could not be read.',
      });
    } finally {
      pairingController.current = null;
    }
  }

  if (!permission) {
    return (
      <View style={[styles.permissionScreen, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View
        style={[styles.permissionScreen, { backgroundColor: colors.background }]}
        testID="qr-permission"
      >
        <View style={[styles.permissionIcon, { backgroundColor: colors.accentSoft }]}>
          <SymbolView name="qrcode.viewfinder" size={36} tintColor={colors.accent} />
        </View>
        <Text style={[styles.permissionTitle, { color: colors.text }]}>
          Scan the code on your Mac
        </Text>
        <Text style={[styles.permissionBody, { color: colors.secondary }]}>
          {permission.canAskAgain
            ? 'Camera access is used only to read a Money Monitor pairing QR. No image is saved.'
            : 'Camera access is off. Enable it in Settings to scan the pairing code.'}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            void (permission.canAskAgain ? requestPermission() : Linking.openSettings())
          }
          style={({ pressed }) => [
            styles.permissionButton,
            { backgroundColor: colors.accent, opacity: pressed ? 0.72 : 1 },
          ]}
        >
          <Text style={styles.permissionButtonLabel}>
            {permission.canAskAgain ? 'Allow camera' : 'Open Settings'}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={styles.cancelButton}
        >
          <Text style={[styles.cancelLabel, { color: colors.accent }]}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.scanner} testID="qr-scanner">
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={state.kind === 'scanning' ? onScanned : undefined}
      />
      <View style={[styles.topBar, { paddingTop: insets.top + 7 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close scanner"
          onPress={() => router.back()}
          style={styles.closeButton}
        >
          <SymbolView name="xmark" size={17} tintColor="#FFFFFF" weight="semibold" />
        </Pressable>
        <Text style={styles.scannerTitle}>Connect to Mac</Text>
        <View style={styles.closeButton} />
      </View>

      {state.kind === 'scanning' ? (
        <View style={styles.targetArea}>
          <View style={styles.target} />
          <Text style={styles.scanInstruction}>Hold the pairing code inside the frame</Text>
          <Text style={styles.scanPrivacy}>The connection stays inside your Tailnet</Text>
        </View>
      ) : (
        <ScanResult
          state={state}
          bottomInset={insets.bottom}
          onAgain={() => setState({ kind: 'scanning' })}
          onDone={() => router.replace('/(tabs)/home')}
        />
      )}
    </View>
  );
}

function ScanResult({
  state,
  bottomInset,
  onAgain,
  onDone,
}: {
  state: Exclude<ScanState, { kind: 'scanning' }>;
  bottomInset: number;
  onAgain: () => void;
  onDone: () => void;
}) {
  const colors = useAppColors();
  const working = state.kind === 'working';
  const connected = state.kind === 'result' && state.connected === true;
  const progress = state.kind === 'working' ? state.progress : null;
  const title =
    progress === 'checking'
      ? 'Checking your Mac'
      : progress === 'requesting'
        ? 'Requesting access'
        : progress === 'awaiting-approval'
          ? 'Approve on your Mac'
          : progress === 'exchanging'
            ? 'Finishing pairing'
            : connected
              ? 'Connected to your Mac'
              : 'Could not connect';
  const message =
    state.kind === 'result' && state.error
      ? state.error
      : state.kind === 'result' && state.health && !state.health.reachable
        ? state.health.message
        : connected
          ? 'Home and Activity will now show data calculated by Money Monitor on your Mac.'
          : progress === 'awaiting-approval'
            ? 'In Money Monitor Settings, approve this iPhone before the code expires.'
            : progress === 'exchanging'
              ? 'Saving the private device credential in the iOS Keychain…'
              : progress === 'requesting'
                ? 'Asking Money Monitor to show an approval request…'
                : 'Calling the Mac health endpoint over private HTTPS…';

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        styles.resultSheet,
        { backgroundColor: colors.surface, paddingBottom: Math.max(bottomInset, 18) },
      ]}
      testID={connected ? 'connectivity-reachable' : 'connectivity-result'}
    >
      <View style={styles.resultHeading}>
        {working ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <SymbolView
            name={connected ? 'checkmark.circle.fill' : 'exclamationmark.triangle.fill'}
            size={28}
            tintColor={connected ? colors.accent : colors.warning}
          />
        )}
        <View style={styles.resultCopy}>
          <Text style={[styles.resultTitle, { color: colors.text }]}>{title}</Text>
          <Text style={[styles.resultMessage, { color: colors.secondary }]}>{message}</Text>
        </View>
      </View>
      {'pairing' in state && state.pairing ? (
        <Text numberOfLines={2} style={[styles.serverAddress, { color: colors.tertiary }]}>
          {state.pairing.baseURL}
        </Text>
      ) : null}
      {!working ? (
        <Pressable
          accessibilityRole="button"
          onPress={connected ? onDone : onAgain}
          style={({ pressed }) => [
            styles.againButton,
            { borderColor: colors.separator, opacity: pressed ? 0.65 : 1 },
          ]}
        >
          <Text style={[styles.againLabel, { color: colors.accent }]}>
            {connected ? 'View Home' : 'Scan another code'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  permissionScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
  },
  permissionIcon: {
    width: 72,
    height: 72,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 25,
  },
  permissionTitle: { fontSize: 25, lineHeight: 31, fontWeight: '700', textAlign: 'center' },
  permissionBody: { marginTop: 11, fontSize: 16, lineHeight: 23, textAlign: 'center' },
  permissionButton: {
    minWidth: 175,
    minHeight: 50,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 27,
  },
  permissionButtonLabel: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  cancelButton: {
    minWidth: 100,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 5,
  },
  cancelLabel: { fontSize: 17, fontWeight: '600' },
  scanner: { flex: 1, backgroundColor: '#000000' },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
    paddingHorizontal: 18,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  scannerTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  targetArea: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 70 },
  target: {
    width: 252,
    height: 252,
    borderRadius: 26,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    backgroundColor: 'transparent',
  },
  scanInstruction: {
    color: '#FFFFFF',
    marginTop: 25,
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowRadius: 8,
  },
  scanPrivacy: {
    color: 'rgba(255,255,255,0.8)',
    marginTop: 7,
    fontSize: 13,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowRadius: 8,
  },
  resultSheet: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    borderRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 21,
  },
  resultHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 13 },
  resultCopy: { flex: 1 },
  resultTitle: { fontSize: 19, fontWeight: '700' },
  resultMessage: { marginTop: 5, fontSize: 14, lineHeight: 20 },
  serverAddress: { marginTop: 15, fontSize: 12, lineHeight: 17 },
  againButton: {
    minHeight: 47,
    marginTop: 17,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  againLabel: { fontSize: 16, fontWeight: '600' },
});
