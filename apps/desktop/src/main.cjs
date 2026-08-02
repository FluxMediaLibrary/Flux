const fs = require('node:fs');
const path = require('node:path');
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  shell,
} = require('electron');
const { autoUpdater } = require('electron-updater');
const { DiscordPresenceService } = require('./discord-service.cjs');
const { desktopReleaseFeedUrl, selectLatestDesktopRelease } = require('./release-channel.cjs');
const { isSameServer, normalizeServerUrl } = require('./server-url.cjs');

const REPOSITORY_URL = 'https://github.com/FluxMediaLibrary/Flux';
const UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000;
const packageMetadata = require('../package.json');
const discordClientId = String(process.env.FLUX_DISCORD_CLIENT_ID || packageMetadata.fluxDiscordClientId || '').trim();

let mainWindow = null;
let manualUpdateCheck = false;
let updateTimer = null;
let quittingForUpdate = false;
let discord = null;

async function configureDesktopUpdateFeed() {
  const response = await net.fetch(`${REPOSITORY_URL.replace('github.com', 'api.github.com/repos')}/releases?per_page=100`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Flux-Desktop',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`GitHub Releases returned HTTP ${response.status}.`);
  const release = selectLatestDesktopRelease(await response.json());
  if (!release) throw new Error('No published Flux desktop release was found.');
  autoUpdater.setFeedURL({ provider: 'generic', url: desktopReleaseFeedUrl(release.tag_name) });
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'desktop-settings.json');
}

function readSettings() {
  try {
    const value = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    return { serverUrl: value.serverUrl ? normalizeServerUrl(value.serverUrl) : null };
  } catch {
    return { serverUrl: null };
  }
}

function writeSettings(settings) {
  const target = settingsPath();
  const temporary = `${target}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, target);
}

function setupUrl() {
  return new URL(`file:///${path.join(__dirname, '..', 'renderer', 'setup.html').replaceAll('\\', '/')}`).toString();
}

function trustedSender(event, allowSetup = false) {
  const senderUrl = event.senderFrame?.url || '';
  const serverUrl = readSettings().serverUrl;
  if (serverUrl && isSameServer(senderUrl, serverUrl)) return true;
  return allowSetup && senderUrl === setupUrl();
}

function requireTrustedSender(event, allowSetup = false) {
  if (!trustedSender(event, allowSetup)) throw new Error('The desktop bridge rejected an untrusted page.');
}

function requireSetupSender(event) {
  if (event.senderFrame?.url !== setupUrl()) {
    throw new Error('Server configuration is only available from the native setup screen.');
  }
}

async function probeServer(serverUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await net.fetch(`${serverUrl}/health`, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    });
    if (response.status >= 500) throw new Error(`Server returned HTTP ${response.status}.`);
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('The server did not respond within 8 seconds.');
    throw new Error(`Could not reach this Flux server. ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

function openSetup() {
  discord?.clear().catch(() => {});
  return mainWindow?.loadURL(setupUrl());
}

function openFlux() {
  const serverUrl = readSettings().serverUrl;
  if (!serverUrl) return openSetup();
  return mainWindow?.loadURL(`${serverUrl}/library`);
}

function configureNavigation(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    const serverUrl = readSettings().serverUrl;
    if (serverUrl && isSameServer(url, serverUrl)) {
      window.loadURL(url).catch(() => {});
      return { action: 'deny' };
    }
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  const guardNavigation = (event, url) => {
    const serverUrl = readSettings().serverUrl;
    if (url === setupUrl() || (serverUrl && isSameServer(url, serverUrl))) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
  };
  window.webContents.on('will-navigate', guardNavigation);
  window.webContents.on('will-redirect', guardNavigation);

  const canUseFullscreen = (webContents, requestingUrl) => {
    const serverUrl = readSettings().serverUrl;
    return Boolean(
      serverUrl
      && webContents === window.webContents
      && isSameServer(requestingUrl || webContents.getURL(), serverUrl),
    );
  };

  window.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin) => (
    permission === 'fullscreen' && canUseFullscreen(webContents, requestingOrigin)
  ));
  window.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(
      permission === 'fullscreen'
      && canUseFullscreen(webContents, details.requestingUrl),
    );
  });
}

function getWindowState() {
  return {
    maximized: Boolean(mainWindow?.isMaximized()),
    fullscreen: Boolean(mainWindow?.isFullScreen()),
  };
}

function sendWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('desktop:window-state-changed', getWindowState());
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: '#080b0d',
    icon: path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });

  configureNavigation(mainWindow);
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return;
    mainWindow.maximize();
    mainWindow.show();
  });
  mainWindow.on('maximize', sendWindowState);
  mainWindow.on('unmaximize', sendWindowState);
  mainWindow.on('enter-full-screen', sendWindowState);
  mainWindow.on('leave-full-screen', sendWindowState);
  mainWindow.on('closed', () => { mainWindow = null; });
  openFlux().catch((error) => {
    dialog.showErrorBox('Flux could not start', error.message);
    openSetup().catch(() => {});
  });
}

function buildMenu() {
  const template = [
    {
      label: 'Flux',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.webContents.reload() },
        { label: 'Change Flux Server...', click: () => openSetup() },
        { label: 'Check for Updates...', click: () => checkForUpdates(true) },
        { type: 'separator' },
        { role: process.platform === 'darwin' ? 'close' : 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'View Repository', click: () => shell.openExternal(REPOSITORY_URL) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function checkForUpdates(manual = false) {
  if (!app.isPackaged) {
    if (manual) await dialog.showMessageBox(mainWindow, {
      type: 'info',
      message: 'Updates are available in packaged builds.',
      detail: 'Development mode does not contact GitHub Releases.',
    });
    return;
  }
  manualUpdateCheck = manualUpdateCheck || manual;
  try {
    await configureDesktopUpdateFeed();
    await autoUpdater.checkForUpdates();
  } catch (error) {
    if (manual) await dialog.showMessageBox(mainWindow, {
      type: 'error',
      message: 'Flux could not check for updates.',
      detail: error.message,
    });
    manualUpdateCheck = false;
  }
}

function configureUpdater() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = console;

  autoUpdater.on('update-not-available', async () => {
    if (manualUpdateCheck) await dialog.showMessageBox(mainWindow, {
      type: 'info',
      message: 'Flux is up to date.',
      detail: `Version ${app.getVersion()} is the newest desktop release.`,
    });
    manualUpdateCheck = false;
  });
  autoUpdater.on('error', (error) => {
    console.error('[desktop] updater error', error);
  });
  autoUpdater.on('update-downloaded', async (info) => {
    manualUpdateCheck = false;
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Restart Flux', 'Later'],
      defaultId: 0,
      cancelId: 1,
      message: `Flux ${info.version} is ready.`,
      detail: 'Restart now to finish installing the update. If you choose Later, it will install when Flux closes.',
    });
    if (result.response === 0) {
      quittingForUpdate = true;
      autoUpdater.quitAndInstall(false, true);
    }
  });

  setTimeout(() => checkForUpdates(false), 10_000).unref?.();
  updateTimer = setInterval(() => checkForUpdates(false), UPDATE_INTERVAL_MS);
  updateTimer.unref?.();
}

function registerIpc() {
  ipcMain.handle('desktop:get-app-info', (event) => {
    requireTrustedSender(event, true);
    return {
      version: app.getVersion(),
      platform: process.platform,
      serverUrl: readSettings().serverUrl,
      discordRichPresence: discord?.enabled ?? false,
      repositoryUrl: REPOSITORY_URL,
    };
  });

  ipcMain.handle('desktop:get-server-config', (event) => {
    requireSetupSender(event);
    return { serverUrl: readSettings().serverUrl };
  });

  ipcMain.handle('desktop:configure-server', async (event, input) => {
    requireSetupSender(event);
    const serverUrl = normalizeServerUrl(input);
    await probeServer(serverUrl);
    writeSettings({ serverUrl });
    await openFlux();
    return { ok: true, serverUrl };
  });

  ipcMain.handle('desktop:change-server', async (event) => {
    requireTrustedSender(event, true);
    await openSetup();
    return { ok: true };
  });

  ipcMain.handle('desktop:check-for-updates', async (event) => {
    requireTrustedSender(event, true);
    await checkForUpdates(true);
    return { ok: true };
  });

  ipcMain.handle('desktop:get-window-state', (event) => {
    requireTrustedSender(event, true);
    return getWindowState();
  });

  ipcMain.handle('desktop:minimize-window', (event) => {
    requireTrustedSender(event, true);
    mainWindow?.minimize();
    return getWindowState();
  });

  ipcMain.handle('desktop:toggle-maximize-window', (event) => {
    requireTrustedSender(event, true);
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
    return getWindowState();
  });

  ipcMain.handle('desktop:close-window', (event) => {
    requireTrustedSender(event, true);
    mainWindow?.close();
  });

  ipcMain.on('desktop:set-activity', (event, presence) => {
    if (!trustedSender(event)) return;
    discord?.setPresence(presence).catch((error) => console.warn('[desktop] Discord presence failed', error));
  });

  ipcMain.on('desktop:clear-activity', (event) => {
    if (!trustedSender(event)) return;
    discord?.clear().catch(() => {});
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    discord = new DiscordPresenceService({
      clientId: discordClientId,
      repositoryUrl: REPOSITORY_URL,
    });
    registerIpc();
    buildMenu();
    createWindow();
    configureUpdater();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on('before-quit', () => {
    if (updateTimer) clearInterval(updateTimer);
    discord?.destroy();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' || quittingForUpdate) app.quit();
  });
}
