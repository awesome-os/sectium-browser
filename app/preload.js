'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sectiumChrome', {
  newTab: (url, groupId) => ipcRenderer.send('sectium:new-tab', url, groupId),
  activateTab: (id) => ipcRenderer.send('sectium:activate-tab', id),
  closeTab: (id) => ipcRenderer.send('sectium:close-tab', id),
  navigate: (url) => ipcRenderer.send('sectium:navigate', url),
  back: () => ipcRenderer.send('sectium:back'),
  forward: () => ipcRenderer.send('sectium:forward'),
  reload: () => ipcRenderer.send('sectium:reload'),
  toggleDevTools: () => ipcRenderer.send('sectium:devtools'),
  // Vertical sidebar, split tabs, and tab groups
  toggleSidebar: (expanded) => ipcRenderer.send('sectium:toggle-sidebar', expanded),
  toggleSplit: (targetTabId) => ipcRenderer.send('sectium:toggle-split', targetTabId),
  closeSplit: () => ipcRenderer.send('sectium:close-split'),
  setSplitRatio: (ratio) => ipcRenderer.send('sectium:set-split-ratio', ratio),
  focusSplitPane: (pane) => ipcRenderer.send('sectium:focus-split-pane', pane),
  createGroup: (title, tabId) => ipcRenderer.send('sectium:create-group', title, tabId),
  toggleGroupCollapse: (groupId) => ipcRenderer.send('sectium:toggle-group-collapse', groupId),
  assignTabGroup: (tabId, groupId) => ipcRenderer.send('sectium:assign-tab-group', tabId, groupId),
  deleteGroup: (groupId) => ipcRenderer.send('sectium:delete-group', groupId),
  onTabs: (cb) => ipcRenderer.on('sectium:tabs', (_ev, data) => cb(data)),
});
