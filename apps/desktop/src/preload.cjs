const { contextBridge, ipcRenderer, webFrame } = require('electron');

const TITLE_BAR_HEIGHT = 38;
const PLAYER_DOCK_GUTTER = 48;
const TITLE_BAR_CSS = `
  :root {
    --flux-desktop-titlebar-height: ${TITLE_BAR_HEIGHT}px;
  }

  html.flux-desktop-shell body {
    padding-top: var(--flux-desktop-titlebar-height) !important;
  }

  html.flux-desktop-shell body > main,
  html.flux-desktop-shell body > main .brand,
  html.flux-desktop-shell .centered-viewport,
  html.flux-desktop-shell .fx-player-shell--fill,
  html.flux-desktop-shell .fx-player--fill {
    min-height: calc(100vh - var(--flux-desktop-titlebar-height)) !important;
  }

  html.flux-desktop-shell .watch-stage {
    top: var(--flux-desktop-titlebar-height) !important;
  }

  html.flux-desktop-shell .fx-player {
    --fx-player-bottom-inset: var(--flux-desktop-workarea-bottom, 0px) !important;
  }

  html.flux-desktop-native-fullscreen body {
    padding-top: 0 !important;
  }

  html.flux-desktop-native-fullscreen .watch-stage {
    top: 0 !important;
  }

  #flux-desktop-titlebar {
    position: fixed;
    inset: 0 0 auto 0;
    z-index: 2147483647;
    height: var(--flux-desktop-titlebar-height);
    display: flex;
    align-items: stretch;
    color: rgba(244, 244, 245, 0.82);
    background: rgba(8, 11, 13, 0.97);
    border-bottom: 1px solid rgba(255, 255, 255, 0.075);
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.45);
    font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    user-select: none;
    -webkit-app-region: drag;
  }

  html.flux-desktop-native-fullscreen #flux-desktop-titlebar {
    display: none;
  }

  .flux-desktop-titlebar__brand {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: 9px;
    padding: 0 14px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.13em;
    text-transform: uppercase;
  }

  .flux-desktop-titlebar__mark {
    width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
    border-radius: 5px;
    color: #101318;
    background: #60a5fa;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0;
  }

  .flux-desktop-titlebar__spacer {
    flex: 1;
  }

  .flux-desktop-titlebar__controls {
    display: flex;
    -webkit-app-region: no-drag;
  }

  .flux-desktop-titlebar__button {
    position: relative;
    width: 46px;
    height: ${TITLE_BAR_HEIGHT - 1}px;
    display: grid;
    place-items: center;
    padding: 0;
    color: rgba(244, 244, 245, 0.72);
    background: transparent;
    border: 0;
    border-radius: 0;
    outline: 0;
    cursor: default;
    font: inherit;
    -webkit-app-region: no-drag;
  }

  .flux-desktop-titlebar__button:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.09);
  }

  .flux-desktop-titlebar__button:focus-visible {
    box-shadow: inset 0 0 0 2px #60a5fa;
  }

  .flux-desktop-titlebar__button--close:hover {
    background: #c42b1c;
  }

  .flux-desktop-titlebar__icon {
    position: relative;
    width: 12px;
    height: 12px;
    display: block;
  }

  .flux-desktop-titlebar__icon--minimize::before {
    content: "";
    position: absolute;
    left: 1px;
    right: 1px;
    top: 7px;
    height: 1px;
    background: currentColor;
  }

  .flux-desktop-titlebar__icon--maximize::before {
    content: "";
    position: absolute;
    inset: 1px;
    border: 1px solid currentColor;
  }

  .flux-desktop-titlebar__button[data-maximized="true"] .flux-desktop-titlebar__icon--maximize::before {
    inset: 3px 1px 1px 3px;
  }

  .flux-desktop-titlebar__button[data-maximized="true"] .flux-desktop-titlebar__icon--maximize::after {
    content: "";
    position: absolute;
    inset: 1px 3px 3px 1px;
    border: 1px solid currentColor;
    background: #080b0d;
  }

  .flux-desktop-titlebar__icon--close::before,
  .flux-desktop-titlebar__icon--close::after {
    content: "";
    position: absolute;
    left: 5.5px;
    top: 0;
    width: 1px;
    height: 13px;
    background: currentColor;
  }

  .flux-desktop-titlebar__icon--close::before { transform: rotate(45deg); }
  .flux-desktop-titlebar__icon--close::after { transform: rotate(-45deg); }
`;

function updateWindowState(state) {
  const root = document.documentElement;
  const maximizeButton = document.querySelector('#flux-desktop-maximize');
  const maximized = Boolean(state?.maximized);
  const fullscreen = Boolean(state?.fullscreen);
  const bottomInset = Math.max(0, Number(state?.workAreaInsets?.bottom) || 0);
  root.style.setProperty(
    '--flux-desktop-workarea-bottom',
    `${fullscreen ? 0 : Math.max(PLAYER_DOCK_GUTTER, bottomInset)}px`,
  );
  root.classList.toggle('flux-desktop-native-fullscreen', fullscreen);
  if (maximizeButton) {
    maximizeButton.dataset.maximized = String(maximized);
    maximizeButton.title = maximized ? 'Restore' : 'Maximize';
    maximizeButton.setAttribute('aria-label', maximized ? 'Restore window' : 'Maximize window');
  }
}

function createWindowButton(id, action, icon, label) {
  const button = document.createElement('button');
  button.id = id;
  button.className = `flux-desktop-titlebar__button flux-desktop-titlebar__button--${action}`;
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', `${label} window`);

  const iconElement = document.createElement('span');
  iconElement.className = `flux-desktop-titlebar__icon flux-desktop-titlebar__icon--${icon}`;
  iconElement.setAttribute('aria-hidden', 'true');
  button.append(iconElement);
  return button;
}

function installTitleBar() {
  if (document.querySelector('#flux-desktop-titlebar')) return;

  document.documentElement.classList.add('flux-desktop-shell');
  const titleBar = document.createElement('header');
  titleBar.id = 'flux-desktop-titlebar';
  titleBar.setAttribute('aria-label', 'Flux desktop window controls');

  const brand = document.createElement('div');
  brand.className = 'flux-desktop-titlebar__brand';
  const mark = document.createElement('span');
  mark.className = 'flux-desktop-titlebar__mark';
  mark.textContent = 'F';
  mark.setAttribute('aria-hidden', 'true');
  const name = document.createElement('span');
  name.textContent = 'Flux';
  brand.append(mark, name);

  const spacer = document.createElement('div');
  spacer.className = 'flux-desktop-titlebar__spacer';

  const controls = document.createElement('div');
  controls.className = 'flux-desktop-titlebar__controls';
  const minimize = createWindowButton('flux-desktop-minimize', 'minimize', 'minimize', 'Minimize');
  const maximize = createWindowButton('flux-desktop-maximize', 'maximize', 'maximize', 'Maximize');
  const close = createWindowButton('flux-desktop-close', 'close', 'close', 'Close');
  controls.append(minimize, maximize, close);
  titleBar.append(brand, spacer, controls);
  document.documentElement.append(titleBar);

  minimize.addEventListener('click', () => ipcRenderer.invoke('desktop:minimize-window').catch(() => {}));
  maximize.addEventListener('click', () => ipcRenderer.invoke('desktop:toggle-maximize-window').then(updateWindowState).catch(() => {}));
  close.addEventListener('click', () => ipcRenderer.invoke('desktop:close-window').catch(() => {}));
  titleBar.addEventListener('dblclick', (event) => {
    if (event.target instanceof HTMLButtonElement) return;
    ipcRenderer.invoke('desktop:toggle-maximize-window').then(updateWindowState).catch(() => {});
  });

  ipcRenderer.invoke('desktop:get-window-state').then(updateWindowState).catch(() => {});
}

webFrame.insertCSS(TITLE_BAR_CSS);
ipcRenderer.on('desktop:window-state-changed', (_event, state) => updateWindowState(state));

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', installTitleBar, { once: true });
} else {
  installTitleBar();
}

contextBridge.exposeInMainWorld('FLUX_DESKTOP_APP', true);
contextBridge.exposeInMainWorld('FluxDesktop', Object.freeze({
  isDesktopApp: () => true,
  getAppInfo: () => ipcRenderer.invoke('desktop:get-app-info'),
  getServerConfig: () => ipcRenderer.invoke('desktop:get-server-config'),
  configureServer: (url) => ipcRenderer.invoke('desktop:configure-server', url),
  changeServer: () => ipcRenderer.invoke('desktop:change-server'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-for-updates'),
  getWindowState: () => ipcRenderer.invoke('desktop:get-window-state'),
  minimizeWindow: () => ipcRenderer.invoke('desktop:minimize-window'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('desktop:toggle-maximize-window'),
  closeWindow: () => ipcRenderer.invoke('desktop:close-window'),
  setActivity: (presence) => ipcRenderer.send('desktop:set-activity', presence),
  clearActivity: () => ipcRenderer.send('desktop:clear-activity'),
}));
