import { app, BrowserWindow, dialog, Menu, Notification } from 'electron';
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
  } catch { /* keep default PATH */ }
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
function checkClaudeCli(): boolean {
  try {
    execFileSync('which', ['claude'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// ── 4. Native macOS menu ────────────────────────────────────────────────────
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

// ── 5. Scrape notifications ─────────────────────────────────────────────────
export function notifyScrapeComplete(message: string) {
  if (Notification.isSupported()) {
    new Notification({ title: 'Money Monitor', body: message }).show();
  }
}

// ── 6. Window management ────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;

function createWindow(port: number) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 20, y: 14 },
    webPreferences: {
      preload: join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadURL(`http://localhost:${port}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── 7. App lifecycle ────────────────────────────────────────────────────────
// CRITICAL: Do NOT top-level await app.whenReady() — it deadlocks in ESM.
app.whenReady().then(async () => {
  // About panel
  app.setAboutPanelOptions({
    applicationName: 'Money Monitor',
    applicationVersion: app.getVersion(),
    copyright: 'Personal Finance Tracker',
  });

  buildMenu();

  if (!checkClaudeCli()) {
    dialog.showErrorBox(
      'Claude Code CLI Required',
      'Money Monitor requires Claude Code CLI to be installed.\n\n' +
      'Install it with: npm install -g @anthropic-ai/claude-code\n\n' +
      'The app will continue without AI features.'
    );
  }

  const { createServer } = await import('../dist/server.js');
  const { start, shutdown } = await createServer();
  const port = await start({ port: 0 });

  console.log(`[Electron] Server started on port ${port}`);
  console.log(`[Electron] Data directory: ${dataDir}`);

  createWindow(port);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(port);
    }
  });

  app.on('will-quit', (e) => {
    e.preventDefault();
    shutdown().then(() => app.exit(0));
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
