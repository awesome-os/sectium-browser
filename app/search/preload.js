'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sectiumSearch', {
  query: (q, limit) => ipcRenderer.invoke('sectium:atlaskv-search', q, limit),
});
