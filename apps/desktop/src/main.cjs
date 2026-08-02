const fs = require('node:fs');
const path = require('node:path');
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  screen,
  shell,
} = require('electron');
const { autoUpdater } = require('electron-updater');
const { DiscordPresenceService } = require('./discord-service.cjs');
const { desktopReleaseFeedUrl, selectLatestDesktopRelease } = require('./release-channel.cjs');
const { isSameServer, normalizeServerUrl } = require('./server-url.cjs');
const { buildUpdatePresentation, normalizeUpdateFeedUrl } = require('./update-presentation.cjs');

const REPOSITORY_URL = 'https://github.com/FluxMediaLibrary/Flux';
const UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000;
const packageMetadata = require('../package.json');
const discordClientId = String(process.env.FLUX_DISCORD_CLIENT_ID || packageMetadata.fluxDiscordClientId || '').trim();

let mainWindow = null;
let updateWindow = null;
let manualUpdateCheck = false;
let updateCheckInFlight = false;
let updateRelease = null;
let updatePresentation = null;
let updateTimer = null;
let quittingForUpdate = false;
let htmlFullscreen = false;
let discord = null;

async function configureDesktopUpdateFeed() {
  const feedOverride = String(process.env.FLUX_DESKTOP_UPDATE_FEED_URL || '').trim();
  if (feedOverride) {
    autoUpdater.setFeedURL({ provider: 'generic', url: normalizeUpdateFeedUrl(feedOverride) });
    return {
      name: String(process.env.FLUX_DESKTOP_UPDATE_RELEASE_NAME || '').trim(),
      body: String(process.env.FLUX_DESKTOP_UPDATE_RELEASE_NOTES || '').trim(),
      html_url: null,
    };
  }
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
  return release;
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

function updateUrl() {
  return new URL(`file:///${path.join(__dirname, '..', 'renderer', 'update.html').replaceAll('\\', '/')}`).toString();
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
  let workAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFullScreen() && !htmlFullscreen) {
    const bounds = mainWindow.getBounds();
    const workArea = screen.getDisplayMatching(bounds).workArea;
    workAreaInsets = {
      top: Math.max(0, workArea.y - bounds.y),
      right: Math.max(0, bounds.x + bounds.width - (workArea.x + workArea.width)),
      bottom: Math.max(0, bounds.y + bounds.height - (workArea.y + workArea.height)),
      left: Math.max(0, workArea.x - bounds.x),
    };
  }
  return {
    maximized: Boolean(mainWindow?.isMaximized()),
    fullscreen: Boolean(mainWindow?.isFullScreen() || htmlFullscreen),
    workAreaInsets,
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
  mainWindow.on('move', sendWindowState);
  mainWindow.on('resize', sendWindowState);
  mainWindow.on('enter-full-screen', sendWindowState);
  mainWindow.on('leave-full-screen', sendWindowState);
  mainWindow.webContents.on('enter-html-full-screen', () => {
    htmlFullscreen = true;
    sendWindowState();
  });
  mainWindow.webContents.on('leave-html-full-screen', () => {
    htmlFullscreen = false;
    sendWindowState();
  });
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
  if (updateCheckInFlight) {
    if (manual) await dialog.showMessageBox(mainWindow, {
      type: 'info',
      message: 'Flux is already checking for updates.',
      detail: 'The result will appear as soon as the update check finishes.',
    });
    return;
  }
  updateCheckInFlight = true;
  manualUpdateCheck = manualUpdateCheck || manual;
  try {
    updateRelease = await configureDesktopUpdateFeed();
    await autoUpdater.checkForUpdates();
  } catch (error) {
    if (manual) await dialog.showMessageBox(mainWindow, {
      type: 'error',
      message: 'Flux could not check for updates.',
      detail: error.message,
    });
    manualUpdateCheck = false;
  } finally {
    updateCheckInFlight = false;
  }
}

function sendUpdateState(state) {
  if (!updateWindow || updateWindow.isDestroyed()) return;
  updateWindow.webContents.send('desktop-updater:state-changed', state);
}

async function openUpdatePrompt(info) {
  updatePresentation = {
    phase: 'available',
    ...buildUpdatePresentation(info, updateRelease),
    percent: 0,
    error: null,
  };
  if (updateWindow && !updateWindow.isDestroyed()) {
    sendUpdateState(updatePresentation);
    updateWindow.show();
    updateWindow.focus();
    return;
  }

  updateWindow = new BrowserWindow({
    width: 640,
    height: 560,
    minWidth: 560,
    minHeight: 480,
    parent: mainWindow || undefined,
    modal: Boolean(mainWindow),
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    backgroundColor: '#080b0d',
    icon: path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'update-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  updateWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  updateWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== updateUrl()) event.preventDefault();
  });
  updateWindow.once('ready-to-show', () => updateWindow?.show());
  updateWindow.on('close', (event) => {
    if (!quittingForUpdate && (updatePresentation?.phase === 'downloading' || updatePresentation?.phase === 'installing')) {
      event.preventDefault();
    }
  });
  updateWindow.on('closed', () => { updateWindow = null; });
  await updateWindow.loadURL(updateUrl());
}

function configureUpdater() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = console;

  autoUpdater.on('update-available', (info) => {
    manualUpdateCheck = false;
    openUpdatePrompt(info).catch((error) => console.error('[desktop] update prompt failed', error));
  });

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
    if (updatePresentation?.phase === 'downloading') {
      updatePresentation = { ...updatePresentation, phase: 'error', error: error.message };
      sendUpdateState(updatePresentation);
    }
  });
  autoUpdater.on('download-progress', (progress) => {
    if (!updatePresentation || updatePresentation.phase !== 'downloading') return;
    updatePresentation = {
      ...updatePresentation,
      percent: Math.max(0, Math.min(100, Number(progress.percent) || 0)),
    };
    sendUpdateState(updatePresentation);
  });
  autoUpdater.on('update-downloaded', (info) => {
    manualUpdateCheck = false;
    updatePresentation = {
      ...(updatePresentation || buildUpdatePresentation(info, updateRelease)),
      phase: 'installing',
      percent: 100,
      error: null,
    };
    sendUpdateState(updatePresentation);
    quittingForUpdate = true;
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 700);
  });

  setTimeout(() => checkForUpdates(false), 10_000).unref?.();
  updateTimer = setInterval(() => checkForUpdates(false), UPDATE_INTERVAL_MS);
  updateTimer.unref?.();
}

function registerIpc() {
  ipcMain.handle('desktop-updater:get-state', (event) => {
    if (event.senderFrame?.url !== updateUrl()) throw new Error('Untrusted update window.');
    return updatePresentation;
  });

  ipcMain.handle('desktop-updater:respond', (event, action) => {
    if (event.senderFrame?.url !== updateUrl()) throw new Error('Untrusted update window.');
    if (action === 'later') {
      if (updatePresentation?.phase !== 'downloading' && updatePresentation?.phase !== 'installing') {
        updateWindow?.close();
      }
      return { ok: true };
    }
    if (action !== 'update' && action !== 'retry') throw new Error('Unknown update action.');
    if (!updatePresentation || !['available', 'error'].includes(updatePresentation.phase)) {
      return { ok: false };
    }
    updatePresentation = { ...updatePresentation, phase: 'downloading', percent: 0, error: null };
    sendUpdateState(updatePresentation);
    autoUpdater.downloadUpdate().catch((error) => {
      updatePresentation = { ...updatePresentation, phase: 'error', error: error.message };
      sendUpdateState(updatePresentation);
    });
    return { ok: true };
  });

  ipcMain.handle('desktop-updater:open-release', (event) => {
    if (event.senderFrame?.url !== updateUrl()) throw new Error('Untrusted update window.');
    if (updatePresentation?.releaseUrl) shell.openExternal(updatePresentation.releaseUrl).catch(() => {});
    return { ok: true };
  });

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
