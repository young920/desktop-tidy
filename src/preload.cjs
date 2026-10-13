const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('tidy', {
  state: () => ipcRenderer.invoke('state'), scan: () => ipcRenderer.invoke('scan'), execute: plan => ipcRenderer.invoke('execute', plan),
  undo: id => ipcRenderer.invoke('undo', id), saveSettings: settings => ipcRenderer.invoke('save-settings', settings),
  chooseRoot: () => ipcRenderer.invoke('choose-root'), openPath: target => ipcRenderer.invoke('open-path', target),
  searchStatus: () => ipcRenderer.invoke('search-status'), searchChooseFolder: () => ipcRenderer.invoke('search-choose-folder'),
  searchScan: folder => ipcRenderer.invoke('search-scan', folder), searchCancel: () => ipcRenderer.invoke('search-cancel'),
  searchQuery: filters => ipcRenderer.invoke('search-query', filters), searchReveal: target => ipcRenderer.invoke('search-reveal', target),
  searchOpen: target => ipcRenderer.invoke('search-open', target),
  searchTrash: paths => ipcRenderer.invoke('search-trash', paths),
  managerState: () => ipcRenderer.invoke('manager-state'), managerChooseRoot: () => ipcRenderer.invoke('manager-choose-root'),
  managerReadFolder: folder => ipcRenderer.invoke('manager-read-folder', folder), managerChooseTarget: start => ipcRenderer.invoke('manager-choose-target', start),
  managerMove: (sources, destination) => ipcRenderer.invoke('manager-move', sources, destination), managerUndo: id => ipcRenderer.invoke('manager-undo', id),
  managerCreateFolder: (parent, name) => ipcRenderer.invoke('manager-create-folder', parent, name),
  managerState: () => ipcRenderer.invoke('manager-state'), managerChooseRoot: () => ipcRenderer.invoke('manager-choose-root'),
  managerReadFolder: folder => ipcRenderer.invoke('manager-read-folder', folder), managerChooseTarget: start => ipcRenderer.invoke('manager-choose-target', start),
  managerMove: (sources, destination) => ipcRenderer.invoke('manager-move', sources, destination), managerUndo: id => ipcRenderer.invoke('manager-undo', id),
  onSearchProgress: callback => { const handler = (_event, progress) => callback(progress); ipcRenderer.on('search-progress', handler); return () => ipcRenderer.removeListener('search-progress', handler); }
});
