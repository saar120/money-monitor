import { app, BrowserWindow, dialog, Menu, nativeTheme, powerMonitor, powerSaveBlocker, systemPreferences } from 'electron';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// ── Fix PATH for packaged macOS apps (Finder/Spotlight launch with minimal PATH) ─
if (process.platform === 'darwin' && !process.env.PATH?.includes('/usr/local/bin')) {
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

// ── 3. Get macOS accent color ────────────────────────────────────────────────
function getAccentColor(): string {
  if (process.platform !== 'darwin') return '#007AFF';
  try {
    const hex = systemPreferences.getAccentColor();
    return `#${hex.slice(0, 6)}`;
  } catch {
    return nativeTheme.shouldUseDarkColors ? '#0A84FF' : '#007AFF';
  }
}

// ── 5. Native macOS menu ────────────────────────────────────────────────────
function buildMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
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
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── 6. Prevent macOS App Nap from suspending background work ─────────────────
// 'prevent-app-suspension' keeps the process alive for cron jobs and SSE
// streams without preventing the display from sleeping.
const powerSaveId = powerSaveBlocker.start('prevent-app-suspension');
console.log(`[Electron] Power save blocker started (id: ${powerSaveId})`);

// ── 7. Window management ─────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;

function sendAccentColor() {
  if (!mainWindow) return;
  const color = getAccentColor();
  mainWindow.webContents.executeJavaScript(
    `document.documentElement.style.setProperty('--system-accent', '${color}')`
  );
}

function createWindow(port: number) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: join(__dirname, 'icons', 'icon-256.png'),
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 19 },
    vibrancy: 'under-window',
    visualEffectState: 'followWindow',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.loadURL(`http://localhost:${port}`);

  // Send accent color once page is ready
  mainWindow.webContents.on('did-finish-load', () => {
    sendAccentColor();
  });

  // Track focus/blur for UI desaturation
  mainWindow.on('focus', () => {
    mainWindow?.webContents.executeJavaScript(
      `document.documentElement.classList.remove('window-blurred')`
    );
  });
  mainWindow.on('blur', () => {
    mainWindow?.webContents.executeJavaScript(
      `document.documentElement.classList.add('window-blurred')`
    );
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
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

    // Start server import
    const { createServer } = await import('../dist/server.js');
    const { start, shutdown, onResume } = await createServer();
    const port = await start({ port: 0 });

    console.log(`[Electron] Server started on port ${port}`);
    console.log(`[Electron] Data directory: ${dataDir}`);

    createWindow(port);

    // Re-send accent color when system preferences change
    nativeTheme.on('updated', () => {
      sendAccentColor();
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
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
      `The application could not start:\n\n${message}\n\nPlease check the logs or reinstall.`
    );
    app.exit(1);
  }
});

app.on('window-all-closed', () => {
  app.quit();
});
