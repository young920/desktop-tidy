const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('tidy', {
  state: () => ipcRenderer.invoke('state'), scan: () => ipcRenderer.invoke('scan'), execute: plan => ipcRenderer.invoke('execute', plan),
  undo: id => ipcRenderer.invoke('undo', id), saveSettings: settings => ipcRenderer.invoke('save-settings', settings),
  chooseRoot: () => ipcRenderer.invoke('choose-root'), openPath: target => ipcRenderer.invoke('open-path', target)
});
