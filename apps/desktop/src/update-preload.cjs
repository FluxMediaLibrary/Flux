const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('FluxDesktopUpdater', Object.freeze({
  getState: () => ipcRenderer.invoke('desktop-updater:get-state'),
  respond: (action) => ipcRenderer.invoke('desktop-updater:respond', action),
  openRelease: () => ipcRenderer.invoke('desktop-updater:open-release'),
  onStateChanged: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('desktop-updater:state-changed', listener);
    return () => ipcRenderer.removeListener('desktop-updater:state-changed', listener);
  },
}));
