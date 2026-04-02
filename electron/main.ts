import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  powerMonitor,
  powerSaveBlocker,
  safeStorage,
  shell,
  systemPreferences,
  Tray,
} from 'electron';
import type { BrowserWindowConstructorOptions } from 'electron';
import { autoUpdater } from 'electron-updater';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

// ── Fix PATH for packaged macOS apps (Finder/Spotlight launch with minimal PATH) ─
if (isMac && !process.env.PATH?.includes('/usr/local/bin')) {
  try {
    const shellPath = execFileSync('/bin/zsh', ['-ilc', 'echo $PATH'], {
      encoding: 'utf8',
      timeout: 5000,
    }).trim();
    process.env.PATH = shellPath;
  } catch (e) {
    console.warn('[Electron] Failed to resolve shell PATH:', e instanceof Error ? e.message : e);
  }
}

// ── Strip macOS quarantine from unpacked native modules on first launch ──────
// When users download and extract the zip, macOS applies com.apple.quarantine
// to all files.  The app itself may pass Gatekeeper (ad-hoc signed), but
// unpacked native binaries (better-sqlite3, puppeteer-core) can still be
// blocked.  Stripping the attribute early prevents "damaged" errors.
if (isMac && app.isPackaged) {
  const appUnpacked = join(process.resourcesPath, 'app.asar.unpacked');
  const quarantineDone = join(app.getPath('userData'), '.quarantine-stripped');
  if (!existsSync(quarantineDone)) {
    try {
      execFileSync('/usr/bin/xattr', ['-cr', appUnpacked], { timeout: 10000 });
      writeFileSync(quarantineDone, '', { mode: 0o600 });
      console.log('[Electron] Quarantine attributes stripped from unpacked modules');
    } catch (e) {
      console.warn('[Electron] Failed to strip quarantine:', e instanceof Error ? e.message : e);
    }
  }
}

// ── Set app name (affects userData path and menu bar) ────────────────────────
app.name = 'Money Monitor';

// ── 1. Set data directory BEFORE any backend import ──────────────────────────
const dataDir = app.getPath('userData');
process.env.MONEY_MONITOR_DATA_DIR = dataDir;

// ── 2. Auto-generate auth token for this session ────────────────────────────
const authToken = randomBytes(32).toString('hex');
process.env.API_TOKEN = authToken;

// ── Expose app version for preload ───────────────────────────────────────────
process.env.MM_APP_VERSION = app.getVersion();

// ── 3. Get system accent color ───────────────────────────────────────────────
function getAccentColor(): string {
  if (isMac || isWin) {
    try {
      const hex = systemPreferences.getAccentColor();
      return `#${hex.slice(0, 6)}`;
    } catch {
      // Fall through to default
    }
  }
  return nativeTheme.shouldUseDarkColors ? '#0A84FF' : '#007AFF';
}

// ── 5. Native menu (platform-aware) ─────────────────────────────────────────
function buildMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [];

  // macOS gets the app-name submenu with hide/quit actions
  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  template.push(
    {
      label: 'File',
      submenu: isMac ? [{ role: 'close' }] : [{ role: 'quit' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        // Only expose dev tools in development builds
        ...(app.isPackaged
          ? []
          : [
              { role: 'reload' as const },
              { role: 'forceReload' as const },
              { role: 'toggleDevTools' as const },
              { type: 'separator' as const },
            ]),
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: isMac
        ? [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
        : [{ role: 'minimize' }, { role: 'close' }],
    },
  );

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── 6. Prevent macOS App Nap from suspending background work ─────────────────
// 'prevent-app-suspension' keeps the process alive for cron jobs and SSE
// streams without preventing the display from sleeping.
const powerSaveId = powerSaveBlocker.start('prevent-app-suspension');
console.log(`[Electron] Power save blocker started (id: ${powerSaveId})`);

// ── 7. Window management ─────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

function sendAccentColor() {
  if (!mainWindow) return;
  const color = getAccentColor();
  mainWindow.webContents.executeJavaScript(
    `document.documentElement.style.setProperty('--system-accent', '${color}')`,
  );
}

function createWindow(port: number) {
  const windowOptions: BrowserWindowConstructorOptions = {
    show: false, // prevent white flash — show only after ready-to-show
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 520,
    icon: join(__dirname, 'icons', isWin ? 'icon.ico' : 'icon-256.png'),
    webPreferences: {
      preload: join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: true,
    },
  };

  // macOS-specific window chrome
  if (isMac) {
    windowOptions.titleBarStyle = 'hiddenInset';
    windowOptions.trafficLightPosition = { x: 20, y: 19 };
    windowOptions.vibrancy = 'under-window';
    windowOptions.visualEffectState = 'followWindow';
    windowOptions.backgroundColor = '#00000000';
    windowOptions.acceptFirstMouse = true; // respond to first click on unfocused window
  } else {
    // Windows/Linux: set background to match theme to prevent white flash
    // and provide correct backdrop for glass compositing in dark mode
    windowOptions.backgroundColor = nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#ffffff';
    windowOptions.autoHideMenuBar = true;
  }

  mainWindow = new BrowserWindow(windowOptions);

  // Show window only after content is painted (prevents white flash on startup)
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.loadURL(`http://localhost:${port}`);

  // Send accent color once page is ready + lock zoom level
  mainWindow.webContents.on('did-finish-load', () => {
    sendAccentColor();
    // Lock zoom — desktop apps don't zoom like browsers
    mainWindow?.webContents.setZoomFactor(1);
    mainWindow?.webContents.setVisualZoomLevelLimits(1, 1);
  });

  // ── Block browser-like navigation (back/forward, dropped URLs, ctrl+click) ──
  const appOrigin = `http://localhost:${port}`;
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(appOrigin)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  // Block ctrl+click / middle-click / target="_blank" from opening new windows
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // ── Block zoom keyboard shortcuts in production ─────────────────────────────
  if (app.isPackaged) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      const isMeta = input.meta || input.control;
      // Block zoom shortcuts (Cmd/Ctrl + =/-/0)
      if (isMeta && ['+', '=', '-', '0'].includes(input.key)) {
        event.preventDefault();
      }
    });
  }

  // Track focus/blur for UI desaturation
  mainWindow.on('focus', () => {
    mainWindow?.webContents.executeJavaScript(
      `document.documentElement.classList.remove('window-blurred')`,
    );
  });
  mainWindow.on('blur', () => {
    mainWindow?.webContents.executeJavaScript(
      `document.documentElement.classList.add('window-blurred')`,
    );
  });

  // Hide to tray instead of closing when the user clicks X
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray(port: number) {
  let icon: Electron.NativeImage;
  if (isMac) {
    // Electron auto-detects 'Template' in filename and picks up @2x for retina
    icon = nativeImage.createFromPath(join(__dirname, 'icons', 'trayTemplate.png'));
    icon.setTemplateImage(true);
  } else if (isWin) {
    icon = nativeImage.createFromPath(join(__dirname, 'icons', 'icon.ico'));
  } else {
    icon = nativeImage.createFromPath(join(__dirname, 'icons', 'icon-256.png'));
  }
  tray = new Tray(icon);
  tray.setToolTip('Money Monitor');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Money Monitor',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow(port);
        }
      },
    },
    {
      label: 'Scrape Now',
      click: () => {
        fetch(`http://localhost:${port}/api/scrape/all`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
        }).catch((err) => console.error('[Tray] Scrape request failed:', err));
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

// ── Auto-updater ────────────────────────────────────────────────────────────

const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
let updateCheckTimer: ReturnType<typeof setInterval> | null = null;

/** Read the AUTO_UPDATE_ENABLED flag from config.json (defaults to true). */
function isAutoUpdateEnabled(): boolean {
  try {
    const raw = JSON.parse(readFileSync(join(dataDir, 'config.json'), 'utf-8'));
    return raw.AUTO_UPDATE_ENABLED !== 'false';
  } catch {
    return true; // default on
  }
}

/** Persist the AUTO_UPDATE_ENABLED flag to config.json. */
function setAutoUpdateEnabled(enabled: boolean): void {
  let raw: Record<string, string> = {};
  try {
    raw = JSON.parse(readFileSync(join(dataDir, 'config.json'), 'utf-8'));
  } catch {
    // file doesn't exist yet
  }
  raw.AUTO_UPDATE_ENABLED = String(enabled);
  writeFileSync(join(dataDir, 'config.json'), JSON.stringify(raw, null, 2), { mode: 0o600 });
}

function sendUpdateStatus(
  status: string,
  info?: { version?: string; percent?: number; error?: string },
) {
  mainWindow?.webContents.send('auto-update:status', { status, ...info });
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdater] Checking for updates...');
    sendUpdateStatus('checking');
  });

  autoUpdater.on('update-available', (info) => {
    console.log(`[AutoUpdater] Update available: v${info.version}`);
    sendUpdateStatus('available', { version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[AutoUpdater] App is up to date');
    sendUpdateStatus('up-to-date');
  });

  autoUpdater.on('download-progress', (progress) => {
    console.log(`[AutoUpdater] Download progress: ${Math.round(progress.percent)}%`);
    sendUpdateStatus('downloading', { percent: progress.percent });
  });

  autoUpdater.on('update-downloaded', async (info) => {
    console.log(`[AutoUpdater] Update downloaded: v${info.version}`);
    sendUpdateStatus('ready', { version: info.version });
    const options = {
      type: 'info' as const,
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      title: 'Update Ready',
      message: `Version ${info.version} has been downloaded.`,
      detail: 'Restart the application to apply the update.',
    };
    const { response } = mainWindow
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options);
    if (response === 0) {
      isQuitting = true;
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('[AutoUpdater] Error:', err.message);
    sendUpdateStatus('error', { error: err.message });
  });

  ipcMain.handle('auto-update:check', async () => {
    const result = await autoUpdater.checkForUpdatesAndNotify();
    return { updateAvailable: !!result?.updateInfo };
  });

  ipcMain.handle('auto-update:install', () => {
    isQuitting = true;
    autoUpdater.quitAndInstall();
  });

  ipcMain.handle('auto-update:get-enabled', () => isAutoUpdateEnabled());

  ipcMain.handle('auto-update:set-enabled', (_event, enabled: boolean) => {
    setAutoUpdateEnabled(enabled);
    if (enabled) {
      startPeriodicChecks();
    } else {
      stopPeriodicChecks();
    }
    return { success: true };
  });

  if (isAutoUpdateEnabled()) {
    autoUpdater.checkForUpdatesAndNotify();
    startPeriodicChecks();
  }
}

function startPeriodicChecks() {
  stopPeriodicChecks();
  updateCheckTimer = setInterval(() => {
    console.log('[AutoUpdater] Periodic update check');
    autoUpdater.checkForUpdatesAndNotify();
  }, UPDATE_CHECK_INTERVAL);
}

function stopPeriodicChecks() {
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }
}

// ── 7. App lifecycle ────────────────────────────────────────────────────────
// CRITICAL: Do NOT top-level await app.whenReady() — it deadlocks in ESM.
app.whenReady().then(async () => {
  try {
    // About panel
    app.setAboutPanelOptions({
      applicationName: 'Money Monitor',
      applicationVersion: app.getVersion(),
      copyright: 'Personal Finance Tracker',
      iconPath: join(__dirname, 'icons', 'icon-512.png'),
    });

    buildMenu();

    // ── Register OS-level safe storage for secrets ────────────────────────────
    // safeStorage uses macOS Keychain, Windows DPAPI, or Linux libsecret to
    // encrypt/decrypt strings.  Registration must happen before the backend
    // import so config.ts can use it when loading secrets from config.json.
    if (safeStorage.isEncryptionAvailable()) {
      const { registerSafeStorage } = await import('../dist/safe-storage.js');
      registerSafeStorage({
        encrypt: (plaintext: string) => safeStorage.encryptString(plaintext),
        decrypt: (encrypted: Buffer) => safeStorage.decryptString(encrypted),
      });
      console.log(
        '[Electron] Safe storage registered (backend:',
        safeStorage.getSelectedStorageBackend?.() ?? 'unknown',
        ')',
      );
    } else {
      console.warn('[Electron] Safe storage not available — secrets will be stored in plaintext');
    }

    // Start server import
    const { createServer } = await import('../dist/server.js');
    const { start, shutdown, onResume } = await createServer();
    const port = await start({ port: 0 });

    console.log(`[Electron] Server started on port ${port}`);

    console.log(`[Electron] Data directory: ${dataDir}`);

    createWindow(port);
    createTray(port);

    // Check for updates (only in packaged builds)
    if (app.isPackaged) {
      setupAutoUpdater();
    }

    // Re-send accent color when system preferences change
    nativeTheme.on('updated', () => {
      sendAccentColor();
    });

    app.on('activate', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      } else {
        createWindow(port);
      }
    });

    // After system sleep, node-cron timers may have drifted, the Telegram
    // polling connection will have dropped, and SSE streams will be stale.
    // Restart all background services and reload the page.
    powerMonitor.on('resume', () => {
      console.log('[Electron] System resumed from sleep — restarting background services');
      onResume();
      mainWindow?.webContents.reload();
    });

    app.on('before-quit', () => {
      isQuitting = true;
      stopPeriodicChecks();
    });

    let quitting = false;
    app.on('will-quit', (e) => {
      if (quitting) return;
      quitting = true;
      e.preventDefault();
      shutdown()
        .catch((err) => console.error('[Electron] Shutdown error:', err))
        .finally(() => app.exit(0));
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Electron] Fatal startup error:', err);
    dialog.showErrorBox(
      'Money Monitor Failed to Start',
      `The application could not start:\n\n${message}\n\nPlease check the logs or reinstall.`,
    );
    app.exit(1);
  }
});

// On macOS and Windows, keep the app running in the tray when all windows are closed.
// On Linux, quit when all windows are closed (no tray-on-close convention).
app.on('window-all-closed', () => {
  if (!isMac && !isWin) {
    app.quit();
  }
});
