'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sectiumChrome', {
  newTab: (url) => ipcRenderer.send('sectium:new-tab', url),
  activateTab: (id) => ipcRenderer.send('sectium:activate-tab', id),
  closeTab: (id) => ipcRenderer.send('sectium:close-tab', id),
  navigate: (url) => ipcRenderer.send('sectium:navigate', url),
  back: () => ipcRenderer.send('sectium:back'),
  forward: () => ipcRenderer.send('sectium:forward'),
  reload: () => ipcRenderer.send('sectium:reload'),
  toggleDevTools: () => ipcRenderer.send('sectium:devtools'),
  onTabs: (cb) => ipcRenderer.on('sectium:tabs', (_ev, data) => cb(data)),
});
