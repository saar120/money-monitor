import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => process.env.MM_APP_VERSION ?? 'unknown',
  getAuthToken: () => process.env.API_TOKEN ?? '',
  getDataPath: () => process.env.MONEY_MONITOR_DATA_DIR ?? '',
});
