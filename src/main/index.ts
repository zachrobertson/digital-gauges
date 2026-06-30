import { app, BrowserWindow, Menu, protocol, shell } from 'electron';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { join } from 'node:path';
import { registerIpc } from './ipc';
import { fetchLocalMedia } from './local-media';
import { fetchUserGaugeModule } from './user-gauge';
import { startUserPluginLoader } from './plugins/loader';

/**
 * Custom protocol used to serve user-picked local video files into the
 * renderer. The renderer runs on http://localhost:5173 in dev (and
 * file:// in prod), neither of which can read arbitrary `file://`
 * paths with `webSecurity: true`. A privileged custom scheme is the
 * standard Electron pattern — we hand it an absolute path in the URL
 * and resolve it server-side via `net.fetch(pathToFileURL(...))`.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  },
  {
    scheme: 'user-gauge',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true,
    },
  },
]);

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#0b0d10',
    // Window/taskbar icon. On Windows/macOS the packaged build uses the
    // executable/bundle icon (set by electron-builder); this primarily covers
    // dev and Linux, where the runtime icon is read from disk.
    icon: join(__dirname, '../../build/icon.png'),
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  mainWindow.on('ready-to-show', () => mainWindow?.show());

  if (process.platform !== 'darwin') {
    mainWindow.setMenuBarVisibility(false);
  }

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.digitalgauges.app');

  // Custom File/Settings menus live in the renderer TopBar. Remove the native
  // menu on Windows/Linux so Alt does not reveal Electron's default menu bar.
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
  }

  // Resolve `local-media://media/?p=<encoded-absolute-path>` → file on disk.
  //
  // The renderer puts the absolute path in a query parameter so it's
  // opaque to Chromium's URL canonicalizer (the path component of a
  // "special" custom scheme would otherwise have drive-letter colons
  // and backslashes normalized in surprising ways).
  protocol.handle('local-media', async (req) => {
    try {
      return await fetchLocalMedia(req);
    } catch (err) {
      console.error('[local-media] fetch failed for', req.url, err);
      return new Response(`local-media error: ${(err as Error).message}`, {
        status: 500,
      });
    }
  });

  protocol.handle('user-gauge', async (req) => {
    try {
      return await fetchUserGaugeModule(req);
    } catch (err) {
      console.error('[user-gauge] fetch failed for', req.url, err);
      return new Response(`user-gauge error: ${(err as Error).message}`, {
        status: 500,
      });
    }
  });

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
    if (process.platform !== 'darwin') {
      window.setMenuBarVisibility(false);
    }
  });

  registerIpc(() => mainWindow);
  startUserPluginLoader(() => mainWindow);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
