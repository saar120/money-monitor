import { app, BrowserWindow, dialog, Menu, nativeTheme, systemPreferences } from 'electron';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
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

// ── 3. Check for Claude Code CLI ─────────────────────────────────────────────
function checkClaudeCli(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('which', ['claude'], (err) => resolve(!err));
  });
}

// ── 4. Get macOS accent color ────────────────────────────────────────────────
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

// ── 6. Window management ─────────────────────────────────────────────────────
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
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 19 },
    vibrancy: 'sidebar',
    visualEffectState: 'followWindow',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
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
    });

    buildMenu();

    // Start server import and CLI check concurrently
    const [serverModule, hasClaude] = await Promise.all([
      import('../dist/server.js'),
      checkClaudeCli(),
    ]);

    if (!hasClaude) {
      dialog.showErrorBox(
        'Claude Code CLI Required',
        'Money Monitor requires Claude Code CLI to be installed.\n\n' +
        'Install it with: npm install -g @anthropic-ai/claude-code\n\n' +
        'The app will continue without AI features.'
      );
    }

    const { createServer } = serverModule;
    const { start, shutdown } = await createServer();
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
