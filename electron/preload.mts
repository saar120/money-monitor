import { contextBridge } from 'electron';

// Add the 'electron' class once the DOM is available.
// document.documentElement is null when preload runs before page load.
document.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('electron');
});

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => process.env.MM_APP_VERSION ?? 'unknown',
  getAuthToken: () => process.env.API_TOKEN ?? '',
  getDataPath: () => process.env.MONEY_MONITOR_DATA_DIR ?? '',
});
