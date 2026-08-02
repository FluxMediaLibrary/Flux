const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('FLUX_DESKTOP_APP', true);
contextBridge.exposeInMainWorld('FluxDesktop', Object.freeze({
  isDesktopApp: () => true,
  getAppInfo: () => ipcRenderer.invoke('desktop:get-app-info'),
  getServerConfig: () => ipcRenderer.invoke('desktop:get-server-config'),
  configureServer: (url) => ipcRenderer.invoke('desktop:configure-server', url),
  changeServer: () => ipcRenderer.invoke('desktop:change-server'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-for-updates'),
  setActivity: (presence) => ipcRenderer.send('desktop:set-activity', presence),
  clearActivity: () => ipcRenderer.send('desktop:clear-activity'),
}));
