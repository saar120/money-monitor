<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import QRCode from 'qrcode';
import { Check, LoaderCircle, QrCode, ShieldCheck, Smartphone, X } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { SettingsGroup, SettingsRow } from '@/components/ui/settings-group';

interface MobileAccessDevice {
  id: string;
  name: string;
  capabilities: string[];
  protocolVersion: number;
  tokenVersion: number;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface MobileAccessPendingRequest {
  pairingId: string;
  status: string;
  deviceName?: string;
  createdAt: string;
  expiresAt: string;
}

interface MobileAccessSnapshot {
  enabled: boolean;
  transport: {
    status: string;
    diagnostic: string;
    publicUrl?: string;
  };
  pairingAvailable: boolean;
  pendingRequests: MobileAccessPendingRequest[];
  devices: MobileAccessDevice[];
  lastActionError?: string;
}

interface MobileAccessElectronAPI {
  getMobileAccessState(): Promise<MobileAccessSnapshot>;
  setMobileAccessEnabled(enabled: boolean): Promise<MobileAccessSnapshot>;
  retryMobileAccess(): Promise<MobileAccessSnapshot>;
  createMobilePairing(
    replacementDeviceId?: string,
  ): Promise<
    | { status: 'created'; encodedPayload: string; expiresAt: string }
    | { status: 'unavailable'; reason: string }
  >;
  approveMobilePairing(pairingId: string): Promise<{ status: string; reason?: string }>;
  rejectMobilePairing(pairingId: string): Promise<{ status: string; reason?: string }>;
  revokeMobileDevice(deviceId: string): Promise<MobileAccessSnapshot>;
}

const electronAPI = (window as unknown as { electronAPI?: Partial<MobileAccessElectronAPI> })
  .electronAPI;

const snapshot = ref<MobileAccessSnapshot | null>(null);
const loading = ref(true);
const changingEnabled = ref(false);
const pairing = ref(false);
const retrying = ref(false);
const actionId = ref('');
const error = ref('');
const qrImage = ref('');
const qrExpiresAt = ref('');
const qrDeviceName = ref('');
let refreshTimer: ReturnType<typeof setInterval> | null = null;

const supported = computed(
  () =>
    !!electronAPI?.getMobileAccessState &&
    !!electronAPI?.setMobileAccessEnabled &&
    !!electronAPI?.createMobilePairing,
);

const statusLabel = computed(() => {
  if (!snapshot.value?.enabled) return 'Off';
  switch (snapshot.value.transport.status) {
    case 'running':
      return 'Private connection ready';
    case 'notInstalled':
      return 'Tailscale is not installed';
    case 'loggedOut':
      return 'Sign in to Tailscale';
    case 'permissionRequired':
      return snapshot.value.transport.diagnostic === 'tailscaleHTTPSRequired'
        ? 'Tailscale HTTPS setup required'
        : 'Tailscale needs permission';
    case 'conflict':
      return 'Private address is already in use';
    case 'failed':
      return snapshot.value.transport.diagnostic === 'tailscaleNotReady'
        ? 'Connect this Mac in Tailscale'
        : 'Private connection unavailable';
    default:
      return 'Starting private connection…';
  }
});

const statusDetail = computed(() => {
  if (snapshot.value?.transport.diagnostic === 'tailscaleHTTPSRequired') {
    return 'Enable HTTPS certificates once in your Tailnet, then Retry.';
  }
  if (snapshot.value?.transport.diagnostic === 'tailscaleNotReady') {
    return 'Wait for Tailscale to finish connecting, then Retry.';
  }
  return '';
});

const statusTone = computed(() => {
  if (snapshot.value?.transport.status === 'running') return 'text-success';
  if (!snapshot.value?.enabled) return 'text-text-secondary';
  return 'text-amber-500';
});

const activeRequests = computed(() =>
  (snapshot.value?.pendingRequests ?? []).filter(
    (request) => request.status === 'pending_approval',
  ),
);

function friendlyError(code?: string): string {
  switch (code) {
    case 'invalid_request':
      return 'The Mobile Access request was not valid.';
    case 'settings_write_failed':
      return 'Money Monitor could not save the Mobile Access setting.';
    case 'pairing_unavailable':
      return 'The private connection must be ready before pairing.';
    case 'device_operation_failed':
      return 'That device could not be updated. Refresh and try again.';
    default:
      return 'Mobile Access is temporarily unavailable.';
  }
}

function formatDate(value: string | null): string {
  if (!value) return 'Never';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

async function refresh(): Promise<void> {
  if (!electronAPI?.getMobileAccessState) return;
  try {
    snapshot.value = await electronAPI.getMobileAccessState();
    if (snapshot.value.pendingRequests.some((request) => request.status === 'pending_approval')) {
      clearQr();
    }
    if (snapshot.value.lastActionError) {
      error.value = friendlyError(snapshot.value.lastActionError);
    }
  } catch {
    error.value = 'Mobile Access status could not be loaded.';
  } finally {
    loading.value = false;
  }
}

async function toggleEnabled(enabled: boolean): Promise<void> {
  if (!electronAPI?.setMobileAccessEnabled) return;
  changingEnabled.value = true;
  error.value = '';
  clearQr();
  try {
    snapshot.value = await electronAPI.setMobileAccessEnabled(enabled);
    if (snapshot.value.lastActionError) {
      error.value = friendlyError(snapshot.value.lastActionError);
    }
  } catch {
    error.value = 'Mobile Access could not be changed.';
  } finally {
    changingEnabled.value = false;
  }
}

async function createPairing(device?: MobileAccessDevice): Promise<void> {
  if (!electronAPI?.createMobilePairing) return;
  pairing.value = true;
  actionId.value = device?.id ?? '';
  error.value = '';
  clearQr();
  try {
    const result = await electronAPI.createMobilePairing(device?.id);
    if (result.status !== 'created') {
      error.value = friendlyError(result.reason);
      return;
    }
    // The nonce is rendered directly into the QR and is never displayed as
    // text, logged, persisted, or placed on the clipboard.
    qrImage.value = await QRCode.toDataURL(result.encodedPayload, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 232,
      color: { dark: '#111827', light: '#FFFFFF' },
    });
    qrExpiresAt.value = result.expiresAt;
    qrDeviceName.value = device?.name ?? '';
  } catch {
    error.value = 'A pairing code could not be created.';
  } finally {
    pairing.value = false;
    actionId.value = '';
  }
}

async function retryTransport(): Promise<void> {
  if (!electronAPI?.retryMobileAccess) return;
  retrying.value = true;
  error.value = '';
  try {
    snapshot.value = await electronAPI.retryMobileAccess();
  } catch {
    error.value = 'The private connection could not be checked.';
  } finally {
    retrying.value = false;
  }
}

async function decidePairing(pairingId: string, approve: boolean): Promise<void> {
  const action = approve ? electronAPI?.approveMobilePairing : electronAPI?.rejectMobilePairing;
  if (!action) return;
  actionId.value = pairingId;
  error.value = '';
  try {
    const result = await action(pairingId);
    if (!['approved', 'rejected', 'already_approved', 'already_rejected'].includes(result.status)) {
      error.value = 'The pairing request is no longer available.';
    }
    await refresh();
  } catch {
    error.value = 'The pairing decision could not be saved.';
  } finally {
    actionId.value = '';
  }
}

async function revokeDevice(device: MobileAccessDevice): Promise<void> {
  if (!electronAPI?.revokeMobileDevice || device.revokedAt) return;
  const confirmed = window.confirm(
    `Revoke ${device.name}? It will lose access on its next connected request.`,
  );
  if (!confirmed) return;

  actionId.value = device.id;
  error.value = '';
  try {
    snapshot.value = await electronAPI.revokeMobileDevice(device.id);
    if (snapshot.value.lastActionError) {
      error.value = friendlyError(snapshot.value.lastActionError);
    }
  } catch {
    error.value = 'The device could not be revoked.';
  } finally {
    actionId.value = '';
  }
}

function clearQr(): void {
  qrImage.value = '';
  qrExpiresAt.value = '';
  qrDeviceName.value = '';
}

function expireQrIfNeeded(): void {
  if (qrExpiresAt.value && Date.parse(qrExpiresAt.value) <= Date.now()) clearQr();
}

onMounted(async () => {
  await refresh();
  refreshTimer = setInterval(() => {
    expireQrIfNeeded();
    if (snapshot.value?.enabled) void refresh();
  }, 2_000);
});

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
  clearQr();
});
</script>

<template>
  <SettingsGroup title="Mobile Access" description="Private iPhone access through your Tailnet">
    <SettingsRow
      label="Allow iPhone access"
      description="Off by default. Bank credentials and scraping stay on this Mac."
    >
      <Switch
        :model-value="snapshot?.enabled ?? false"
        :disabled="loading || changingEnabled || !supported"
        @update:model-value="toggleEnabled"
      />
    </SettingsRow>

    <SettingsRow label="Status">
      <div class="flex items-center gap-3">
        <div class="flex flex-col items-end gap-1">
          <div class="flex items-center gap-2 text-[13px]" :class="statusTone">
            <LoaderCircle
              v-if="loading || changingEnabled || retrying"
              class="h-3.5 w-3.5 animate-spin"
            />
            <ShieldCheck v-else class="h-3.5 w-3.5" />
            <span>{{ supported ? statusLabel : 'Available in the packaged Mac app' }}</span>
          </div>
          <p v-if="statusDetail" class="max-w-[280px] text-right text-[11px] text-text-secondary">
            {{ statusDetail }}
          </p>
        </div>
        <Button
          v-if="snapshot?.enabled && snapshot.transport.status !== 'running'"
          size="sm"
          variant="secondary"
          :disabled="retrying"
          @click="retryTransport"
        >
          Retry
        </Button>
      </div>
    </SettingsRow>

    <SettingsRow v-if="snapshot?.enabled" label="Pair an iPhone" vertical>
      <div class="w-full space-y-3">
        <div class="flex items-center justify-between gap-3">
          <p class="text-[12px] text-text-secondary">
            The code expires after five minutes and still requires approval on this Mac.
          </p>
          <Button
            size="sm"
            variant="secondary"
            :disabled="pairing || !snapshot.pairingAvailable"
            @click="createPairing()"
          >
            <QrCode class="mr-1.5 h-3.5 w-3.5" />
            {{ qrImage ? 'Refresh code' : 'Pair iPhone' }}
          </Button>
        </div>

        <div v-if="qrImage" class="flex flex-col items-center gap-2 rounded-xl bg-white p-4">
          <img
            :src="qrImage"
            class="h-[232px] w-[232px]"
            :alt="`Short-lived iPhone pairing code. Expires ${formatDate(qrExpiresAt)}.`"
          />
          <p class="text-[11px] text-slate-500">Expires {{ formatDate(qrExpiresAt) }}</p>
          <p v-if="qrDeviceName" class="text-center text-[11px] text-slate-500">
            Re-pairing {{ qrDeviceName }} replaces its current access only after approval.
          </p>
        </div>
      </div>
    </SettingsRow>

    <SettingsRow v-if="activeRequests.length" label="Approval requests" vertical>
      <div class="w-full space-y-2">
        <div
          v-for="request in activeRequests"
          :key="request.pairingId"
          class="flex items-center justify-between gap-3 rounded-lg bg-bg-secondary/60 px-3 py-2.5"
        >
          <div class="min-w-0">
            <p class="truncate text-[13px] font-medium text-text-primary">
              {{ request.deviceName || 'iPhone' }}
            </p>
            <p class="text-[11px] text-text-secondary">
              Approval expires {{ formatDate(request.expiresAt) }}
            </p>
          </div>
          <div class="flex shrink-0 gap-2">
            <Button
              size="sm"
              variant="secondary"
              :disabled="actionId === request.pairingId"
              @click="decidePairing(request.pairingId, false)"
            >
              <X class="mr-1 h-3.5 w-3.5" /> Reject
            </Button>
            <Button
              size="sm"
              :disabled="actionId === request.pairingId"
              @click="decidePairing(request.pairingId, true)"
            >
              <Check class="mr-1 h-3.5 w-3.5" /> Approve
            </Button>
          </div>
        </div>
      </div>
    </SettingsRow>

    <SettingsRow v-if="snapshot?.devices.length" label="Paired devices" vertical>
      <div class="w-full divide-y divide-border/70">
        <div
          v-for="device in snapshot.devices"
          :key="device.id"
          class="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
        >
          <div class="flex min-w-0 items-center gap-2.5">
            <Smartphone class="h-4 w-4 shrink-0 text-text-secondary" />
            <div class="min-w-0">
              <p class="truncate text-[13px] font-medium text-text-primary">{{ device.name }}</p>
              <p class="text-[11px] text-text-secondary">
                <span v-if="device.revokedAt" class="text-destructive">
                  Revoked {{ formatDate(device.revokedAt) }}
                </span>
                <span v-else>Last used {{ formatDate(device.lastUsedAt) }}</span>
              </p>
            </div>
          </div>
          <div v-if="!device.revokedAt" class="flex shrink-0 gap-2">
            <Button
              size="sm"
              variant="secondary"
              :disabled="pairing || !snapshot?.pairingAvailable"
              @click="createPairing(device)"
            >
              <QrCode class="mr-1 h-3.5 w-3.5" /> Re-pair
            </Button>
            <Button
              size="sm"
              variant="secondary"
              :disabled="actionId === device.id"
              @click="revokeDevice(device)"
            >
              Revoke
            </Button>
          </div>
        </div>
      </div>
    </SettingsRow>

    <SettingsRow v-if="snapshot?.transport.publicUrl" label="Connection details" vertical>
      <details class="w-full text-[12px] text-text-secondary">
        <summary class="cursor-pointer select-none">Show private address</summary>
        <code class="mt-2 block break-all rounded bg-bg-secondary px-2.5 py-2 text-[11px]">
          {{ snapshot.transport.publicUrl }}
        </code>
      </details>
    </SettingsRow>

    <SettingsRow v-if="error" vertical>
      <p role="status" class="text-[12px] text-destructive">{{ error }}</p>
    </SettingsRow>
  </SettingsGroup>
</template>
