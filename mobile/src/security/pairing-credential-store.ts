import * as SecureStore from 'expo-secure-store';

export type PairingCredential = {
  serverId: string;
  baseURL: string;
  token: string;
};

const KEY = 'money-monitor.pairing-credential.v1';
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

function isValidCredential(value: unknown): value is PairingCredential {
  if (
    !value ||
    typeof value !== 'object' ||
    !('serverId' in value) ||
    !('baseURL' in value) ||
    !('token' in value) ||
    typeof value.serverId !== 'string' ||
    typeof value.baseURL !== 'string' ||
    typeof value.token !== 'string' ||
    !TOKEN.test(value.token)
  ) {
    return false;
  }
  try {
    const url = new URL(value.baseURL);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export async function storePairingCredential(credential: PairingCredential): Promise<void> {
  if (!isValidCredential(credential)) throw new Error('The pairing credential is invalid.');
  await SecureStore.setItemAsync(KEY, JSON.stringify(credential), OPTIONS);
}

export async function readPairingCredential(): Promise<PairingCredential | null> {
  const stored = await SecureStore.getItemAsync(KEY, OPTIONS);
  if (!stored) return null;

  const value: unknown = JSON.parse(stored);
  if (!isValidCredential(value)) {
    throw new Error('The stored pairing credential is invalid.');
  }
  return value;
}

export function deletePairingCredential(): Promise<void> {
  return SecureStore.deleteItemAsync(KEY, OPTIONS);
}
