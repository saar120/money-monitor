import { contextBridge, ipcRenderer } from 'electron';

function isTrustedDocument(): boolean {
  const trustedOrigin = process.env.MM_RENDERER_ORIGIN;
  if (!trustedOrigin) return false;

  try {
    const current = new URL(window.location.href);
    return (
      current.origin === trustedOrigin &&
      current.username.length === 0 &&
      current.password.length === 0
    );
  } catch {
    return false;
  }
}

// Add the 'electron' and platform classes once the DOM is available.
// document.documentElement is null when preload runs before page load.
document.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('electron');
  document.documentElement.classList.add(`platform-${process.platform}`);

  // ── Suppress browser right-click menu (except on editable elements) ─────
  document.addEventListener('contextmenu', (e) => {
    const target = e.target as HTMLElement;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target.isContentEditable
    ) {
      return; // allow native context menu on editable elements for copy/paste
    }
    e.preventDefault();
  });

  // ── Prevent drag-and-drop from navigating away ──────────────────────────
  // Dropping a URL/file onto an Electron window navigates like a browser.
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());
});

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => process.env.MM_APP_VERSION ?? 'unknown',
  getAuthToken: () => (isTrustedDocument() ? (process.env.API_TOKEN ?? '') : ''),
  getDataPath: () => (isTrustedDocument() ? (process.env.MONEY_MONITOR_DATA_DIR ?? '') : ''),
  // Auto-update
  checkForUpdates: () => ipcRenderer.invoke('auto-update:check'),
  installUpdate: () => ipcRenderer.invoke('auto-update:install'),
  getAutoUpdateEnabled: () => ipcRenderer.invoke('auto-update:get-enabled'),
  setAutoUpdateEnabled: (enabled: boolean) =>
    ipcRenderer.invoke('auto-update:set-enabled', enabled),
  // Mobile Access — every payload is sanitized in the main-process control
  // surface before crossing this boundary.
  getMobileAccessState: () => ipcRenderer.invoke('mobile-access:get-state'),
  setMobileAccessEnabled: (enabled: boolean) =>
    ipcRenderer.invoke('mobile-access:set-enabled', enabled),
  retryMobileAccess: () => ipcRenderer.invoke('mobile-access:retry'),
  createMobilePairing: (replacementDeviceId?: string) =>
    ipcRenderer.invoke('mobile-access:create-pairing', replacementDeviceId),
  approveMobilePairing: (pairingId: string) =>
    ipcRenderer.invoke('mobile-access:approve-pairing', pairingId),
  rejectMobilePairing: (pairingId: string) =>
    ipcRenderer.invoke('mobile-access:reject-pairing', pairingId),
  revokeMobileDevice: (deviceId: string) =>
    ipcRenderer.invoke('mobile-access:revoke-device', deviceId),
  setMobileReviewAccess: (deviceId: string, enabled: boolean) =>
    ipcRenderer.invoke('mobile-access:set-review-access', deviceId, enabled),
  onUpdateStatus: (
    callback: (status: {
      status: string;
      version?: string;
      percent?: number;
      error?: string;
    }) => void,
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: { status: string; version?: string; percent?: number; error?: string },
    ) => callback(data);
    ipcRenderer.on('auto-update:status', listener);
    return () => ipcRenderer.removeListener('auto-update:status', listener);
  },
});
