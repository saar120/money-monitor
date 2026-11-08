import * as SecureStore from 'expo-secure-store';
import { File, Paths } from 'expo-file-system';
import {
  AESEncryptionKey,
  AESSealedData,
  aesDecryptAsync,
  aesEncryptAsync,
  digestStringAsync,
  CryptoDigestAlgorithm,
} from 'expo-crypto';
import { createSavedViewStore } from '../saved-view-store';
import type { PairingCredential } from './pairing-credential-store';

const KEY = 'money-monitor.saved-view-key.v1';
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const file = () => new File(Paths.document, 'money-monitor-saved-view.v1.enc');
async function key(create: boolean) {
  const stored = await SecureStore.getItemAsync(KEY, options);
  if (stored) return AESEncryptionKey.import(stored, 'base64');
  if (!create) throw new Error('Saved View key unavailable');
  const generated = await AESEncryptionKey.generate();
  await SecureStore.setItemAsync(KEY, await generated.encoded('base64'), options);
  return generated;
}
export function savedViewIdentity(credential: PairingCredential) {
  return digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(credential));
}
export const savedViewStore = createSavedViewStore({
  async read() {
    const value = file();
    return value.exists ? value.text() : null;
  },
  async write(value) {
    const temporary = new File(Paths.document, 'money-monitor-saved-view.v1.tmp');
    temporary.write(value);
    temporary.move(file(), { overwrite: true });
  },
  async remove() {
    // Destroying the key removes display rights even if file cleanup fails.
    await SecureStore.deleteItemAsync(KEY, options);
    for (const value of [file(), new File(Paths.document, 'money-monitor-saved-view.v1.tmp')])
      if (value.exists) value.delete();
  },
  async encrypt(value) {
    const sealed = await aesEncryptAsync(new TextEncoder().encode(value), await key(true));
    return sealed.combined('base64');
  },
  async decrypt(value) {
    const plaintext = await aesDecryptAsync(AESSealedData.fromCombined(value), await key(false));
    // SDK 57 has TextEncoder but no native TextDecoder yet.
    return decodeURIComponent(
      Array.from(plaintext, (byte) => '%' + byte.toString(16).padStart(2, '0')).join(''),
    );
  },
});
