import {
  app,
  BrowserWindow,
  dialog,
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
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
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
