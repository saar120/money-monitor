import { t } from '../translations.ts';
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

const INVALIDATED_KEY = 'money-monitor.pairing-invalidated.v1';
let writes: Promise<void> = Promise.resolve();
let locallyDeleted = false;
let retiredToken: string | null = null;
const listeners = new Set<() => void>();
function serialize(operation: () => Promise<void>): Promise<void> {
  const next = writes.catch(() => {}).then(operation);
  writes = next;
  return next;
}
export function observePairingCredential(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function changed() {
  listeners.forEach((listener) => listener());
}

export function storePairingCredential(
  credential: PairingCredential,
  signal?: AbortSignal,
): Promise<void> {
  if (!isValidCredential(credential))
    return Promise.reject(new Error(t('thePairingCredentialIsInvalid')));
  return serialize(async () => {
    signal?.throwIfAborted();
    retiredToken = credential.token;
    await SecureStore.setItemAsync(KEY, JSON.stringify(credential), OPTIONS);
    if (signal?.aborted) {
      await SecureStore.setItemAsync(INVALIDATED_KEY, '1', OPTIONS);
      await SecureStore.deleteItemAsync(KEY, OPTIONS);
      signal.throwIfAborted();
    }
    await SecureStore.deleteItemAsync(INVALIDATED_KEY, OPTIONS);
    if (signal?.aborted) {
      await SecureStore.setItemAsync(INVALIDATED_KEY, '1', OPTIONS);
      await SecureStore.deleteItemAsync(KEY, OPTIONS);
      signal.throwIfAborted();
    }
    locallyDeleted = false;
    retiredToken = null;
    changed();
  });
}

export async function readPairingCredential(): Promise<PairingCredential | null> {
  if (locallyDeleted) return null;
  await writes.catch(() => {});
  if (locallyDeleted) return null;
  if (await SecureStore.getItemAsync(INVALIDATED_KEY, OPTIONS)) return null;
  const stored = await SecureStore.getItemAsync(KEY, OPTIONS);
  if (!stored) return null;
  const value: unknown = JSON.parse(stored);
  if (isValidCredential(value) && value.token === retiredToken) return null;
  if (!isValidCredential(value)) throw new Error(t('theStoredPairingCredentialIsInvalid'));
  return value;
}

export function invalidatePairingCredential(expected: PairingCredential): Promise<void> {
  retiredToken = expected.token;
  return serialize(async () => {
    const stored = await SecureStore.getItemAsync(KEY, OPTIONS);
    if (stored && JSON.parse(stored).token !== expected.token) return;
    await SecureStore.setItemAsync(INVALIDATED_KEY, '1', OPTIONS);
    await SecureStore.deleteItemAsync(KEY, OPTIONS);
  });
}

export function deletePairingCredential(): Promise<void> {
  locallyDeleted = true;
  changed();
  return serialize(async () => {
    await SecureStore.setItemAsync(INVALIDATED_KEY, '1', OPTIONS);
    await SecureStore.deleteItemAsync(KEY, OPTIONS);
    changed();
  });
}
