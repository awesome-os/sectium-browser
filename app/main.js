'use strict';

const { app, BrowserWindow, WebContentsView, ipcMain, Menu, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  AtlasKvSearchEngine,
  GOOGLE_NUDGE_BLOCK_PATTERNS,
  GOOGLE_NUDGE_HIDE_CSS,
  buildCleanChromeUserAgent,
  buildGoogleSearchUrl,
  isGoogleHost,
} = require('./search/atlaskv-search.js');
const {
  GROUP_COLORS,
  clampSplitRatio,
  computeViewportBounds,
} = require('./tab-layout.js');

const NEWTAB_URL = pathToFileURL(path.join(__dirname, 'newtab', 'newtab.html')).href;
const SEARCH_PAGE_URL = pathToFileURL(path.join(__dirname, 'search', 'search.html')).href;
const SEARCH_PRELOAD_PATH = path.join(__dirname, 'search', 'preload.js');

const atlasSearch = new AtlasKvSearchEngine();

let mainWin = null;
const tabs = new Map();
const groups = new Map();
let activeTabId = null;
let splitTabId = null; // Secondary right-hand tab when side-by-side split view is active
let focusedPane = 'primary'; // 'primary' | 'secondary'
let sidebarExpanded = false; // Collapsed icon rail (52px) vs expanded vertical tab bar (248px)
let splitRatio = 0.5;
let nextTabId = 1;
let nextGroupId = 1;
const mountedViews = new Set();

function buildAtlasSearchUrl(query) {
  return `${SEARCH_PAGE_URL}?q=${encodeURIComponent(String(query || '').trim())}`;
}

function normalizeUrl(raw) {
  const s = (raw || '').trim();
  if (!s || s === 'sectium://newtab') return NEWTAB_URL;
  if (s === 'sectium://search') return SEARCH_PAGE_URL;
  if (s.startsWith('sectium://search?q=')) {
    return buildAtlasSearchUrl(decodeURIComponent(s.slice('sectium://search?q='.length)));
  }
  if (/^(!g|g)\s+/i.test(s)) {
    return buildGoogleSearchUrl(s.replace(/^(!g|g)\s+/i, ''));
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) return s;
  if (/^localhost(:\d+)?(\/|$)/i.test(s) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(s)) {
    return 'http://' + s;
  }
  if (/^[^\s]+\.[^\s]{2,}$/.test(s)) return 'https://' + s;

  const local = atlasSearch.search(s, 5);
  if (local.results.length > 0 && local.results[0].score >= 0.45) {
    return buildAtlasSearchUrl(s);
  }
  return buildGoogleSearchUrl(s);
}

function getFocusedTab() {
  if (splitTabId != null && focusedPane === 'secondary' && tabs.has(splitTabId)) {
    return tabs.get(splitTabId);
  }
  return activeTabId != null ? tabs.get(activeTabId) || null : null;
}

function syncMountedViews() {
  if (!mainWin || mainWin.isDestroyed()) return;
  const desired = new Set();
  const primary = activeTabId != null ? tabs.get(activeTabId) : null;
  const secondary = splitTabId != null && splitTabId !== activeTabId ? tabs.get(splitTabId) : null;
  if (primary) desired.add(primary.view);
  if (secondary) desired.add(secondary.view);

  for (const v of Array.from(mountedViews)) {
    if (!desired.has(v)) {
      try { mainWin.contentView.removeChildView(v); } catch {}
      mountedViews.delete(v);
    }
  }
  for (const v of desired) {
    if (!mountedViews.has(v)) {
      mainWin.contentView.addChildView(v);
      mountedViews.add(v);
    }
  }
}

function layoutViewport() {
  if (!mainWin || mainWin.isDestroyed() || activeTabId == null) return;
  const primary = tabs.get(activeTabId);
  if (!primary) return;
  const secondary = splitTabId != null && splitTabId !== activeTabId ? tabs.get(splitTabId) : null;
  const [w, h] = mainWin.getContentSize();
  const bounds = computeViewportBounds({
    contentWidth: w,
    contentHeight: h,
    sidebarExpanded,
    splitActive: Boolean(secondary),
    splitRatio,
  });

  syncMountedViews();
  primary.view.setBounds(bounds.primary);
  if (secondary && bounds.secondary) {
    secondary.view.setBounds(bounds.secondary);
  }
}

function formatDisplayUrl(url) {
  if (!url || url === NEWTAB_URL) return '';
  if (url.startsWith(SEARCH_PAGE_URL)) {
    try {
      const q = new URL(url).searchParams.get('q') || '';
      return q ? `sectium://search?q=${q}` : 'sectium://search';
    } catch {
      return 'sectium://search';
    }
  }
  return url;
}

function broadcastTabs() {
  if (!mainWin || mainWin.isDestroyed()) return;
  const list = [];
  for (const [id, t] of tabs.entries()) {
    list.push({
      id,
      title: t.title || 'New Tab',
      url: formatDisplayUrl(t.url),
      favicon: t.favicon || '',
      groupId: t.groupId ?? null,
      active: id === activeTabId,
      splitSecondary: id === splitTabId,
      focused: (splitTabId != null && focusedPane === 'secondary') ? id === splitTabId : id === activeTabId,
      loading: t.loading,
      canGoBack: t.view.webContents.navigationHistory.canGoBack(),
      canGoForward: t.view.webContents.navigationHistory.canGoForward(),
    });
  }
  const groupList = Array.from(groups.values());
  const [w, h] = mainWin.getContentSize();
  const bounds = computeViewportBounds({
    contentWidth: w,
    contentHeight: h,
    sidebarExpanded,
    splitActive: splitTabId != null && splitTabId !== activeTabId && tabs.has(splitTabId),
    splitRatio,
  });
  mainWin.webContents.send('sectium:tabs', {
    tabs: list,
    groups: groupList,
    activeId: activeTabId,
    splitTabId: splitTabId != null && tabs.has(splitTabId) ? splitTabId : null,
    focusedPane,
    sidebarExpanded,
    splitRatio,
    layout: bounds,
    versions: {
      chromium: process.versions.chrome,
      v8: process.versions.v8,
      node: process.versions.node,
      electron: process.versions.electron,
    },
  });
}

function activateTab(id) {
  if (!mainWin || !tabs.has(id)) return;
  if (splitTabId === id) {
    // Clicking the right split tab focuses the right pane without destroying the split
    focusedPane = 'secondary';
  } else if (splitTabId != null && focusedPane === 'secondary') {
    // If right pane is focused and user picks another tab, swap the right pane
    splitTabId = id;
    if (splitTabId === activeTabId) {
      splitTabId = null;
      focusedPane = 'primary';
    }
  } else {
    activeTabId = id;
    focusedPane = 'primary';
  }
  layoutViewport();
  const focused = getFocusedTab();
  if (focused && mainWin) {
    mainWin.setTitle((focused.title ? focused.title + ' — ' : '') + 'Sectium Browser');
  }
  broadcastTabs();
}

function toggleSplit(targetTabId) {
  if (!mainWin || activeTabId == null) return;
  // Clicking split on the currently active split secondary closes split
  if (splitTabId != null && (targetTabId == null || targetTabId === splitTabId)) {
    splitTabId = null;
    focusedPane = 'primary';
    layoutViewport();
    broadcastTabs();
    return;
  }

  let rightId = null;
  if (targetTabId != null && tabs.has(targetTabId) && targetTabId !== activeTabId) {
    rightId = targetTabId;
  } else {
    // Pick the next existing tab, or spawn a fresh tab for the right pane
    for (const id of tabs.keys()) {
      if (id !== activeTabId) {
        rightId = id;
        break;
      }
    }
    if (rightId == null) {
      rightId = createTab(NEWTAB_URL, null, { activate: false });
    }
  }

  splitTabId = rightId;
  focusedPane = 'secondary';
  layoutViewport();
  broadcastTabs();
}

function closeSplit() {
  if (splitTabId == null) return;
  splitTabId = null;
  focusedPane = 'primary';
  layoutViewport();
  broadcastTabs();
}

function injectGoogleNudgeBlockerIfNeeded(wc, url) {
  if (isGoogleHost(url)) {
    wc.insertCSS(GOOGLE_NUDGE_HIDE_CSS).catch(() => {});
  }
}

function createTab(initialUrl, groupId = null, opts = { activate: true }) {
  const id = nextTabId++;
  const view = new WebContentsView({
    webPreferences: {
      preload: SEARCH_PRELOAD_PATH,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: true,
    },
  });
  const wc = view.webContents;
  wc.setBackgroundThrottling(true);
  wc.setUserAgent(buildCleanChromeUserAgent(wc.getUserAgent()));

  const target = normalizeUrl(initialUrl);
  const validGroupId = groupId != null && groups.has(groupId) ? groupId : null;
  const tab = { id, view, title: 'New Tab', url: target, favicon: '', groupId: validGroupId, loading: true };
  tabs.set(id, tab);

  wc.on('page-title-updated', (_ev, title) => {
    tab.title = title || 'Sectium';
    atlasSearch.recordVisit(tab.url, tab.title);
    const focused = getFocusedTab();
    if (focused && focused.id === id && mainWin) mainWin.setTitle(tab.title + ' — Sectium Browser');
    broadcastTabs();
  });
  wc.on('page-favicon-updated', (_ev, favicons) => {
    if (Array.isArray(favicons) && favicons.length > 0) {
      tab.favicon = favicons[0];
      broadcastTabs();
    }
  });
  wc.on('focus', () => {
    if (splitTabId === id && focusedPane !== 'secondary') {
      focusedPane = 'secondary';
      broadcastTabs();
    } else if (activeTabId === id && focusedPane !== 'primary') {
      focusedPane = 'primary';
      broadcastTabs();
    }
  });
  wc.on('dom-ready', () => {
    injectGoogleNudgeBlockerIfNeeded(wc, wc.getURL());
  });
  wc.on('did-navigate', (_ev, url) => {
    tab.url = url;
    injectGoogleNudgeBlockerIfNeeded(wc, url);
    atlasSearch.recordVisit(url, tab.title);
    broadcastTabs();
  });
  wc.on('did-navigate-in-page', (_ev, url) => {
    tab.url = url;
    injectGoogleNudgeBlockerIfNeeded(wc, url);
    broadcastTabs();
  });
  wc.on('did-start-loading', () => {
    tab.loading = true;
    broadcastTabs();
  });
  wc.on('did-stop-loading', () => {
    tab.loading = false;
    broadcastTabs();
  });
  wc.setWindowOpenHandler(({ url }) => {
    createTab(url, tab.groupId);
    return { action: 'deny' };
  });

  wc.loadURL(target).catch(() => {});
  if (opts.activate !== false) {
    if (splitTabId != null && focusedPane === 'secondary') {
      splitTabId = id;
    } else {
      activeTabId = id;
      focusedPane = 'primary';
    }
    layoutViewport();
    broadcastTabs();
  }
  return id;
}

function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  if (mountedViews.has(tab.view)) {
    try { mainWin.contentView.removeChildView(tab.view); } catch {}
    mountedViews.delete(tab.view);
  }
  try { tab.view.webContents.close(); } catch {}
  tabs.delete(id);

  if (tabs.size === 0) {
    if (mainWin) mainWin.close();
    return;
  }

  if (splitTabId === id) {
    splitTabId = null;
    focusedPane = 'primary';
  }
  if (activeTabId === id) {
    if (splitTabId != null && tabs.has(splitTabId)) {
      activeTabId = splitTabId;
      splitTabId = null;
      focusedPane = 'primary';
    } else {
      activeTabId = Array.from(tabs.keys()).pop();
      focusedPane = 'primary';
    }
  }
  layoutViewport();
  broadcastTabs();
}

function createGroup(title, tabId) {
  const id = nextGroupId++;
  const color = GROUP_COLORS[(id - 1) % GROUP_COLORS.length];
  const name = String(title || '').trim() || `Group ${id}`;
  groups.set(id, { id, title: name, color, collapsed: false });
  const targetId = tabId != null && tabs.has(tabId) ? tabId : activeTabId;
  if (targetId != null && tabs.has(targetId)) {
    tabs.get(targetId).groupId = id;
  }
  broadcastTabs();
}

function getInitialUrls() {
  const urls = [];
  for (const arg of process.argv.slice(1)) {
    if (!arg || arg.startsWith('-') || arg === __dirname || arg.endsWith('main.js')) continue;
    if (/^https?:\/\//i.test(arg) || /^file:\/\//i.test(arg) || /^sectium:\/\//i.test(arg)) urls.push(arg);
  }
  return urls.length > 0 ? urls : [NEWTAB_URL];
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  const defaultSes = session.defaultSession;
  defaultSes.setUserAgent(buildCleanChromeUserAgent(defaultSes.getUserAgent()));
  defaultSes.webRequest.onBeforeRequest(
    { urls: GOOGLE_NUDGE_BLOCK_PATTERNS },
    (_details, callback) => callback({ cancel: true }),
  );

  ipcMain.handle('sectium:atlaskv-search', (_ev, q, limit) => atlasSearch.search(q, limit));

  mainWin = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 640,
    minHeight: 420,
    backgroundColor: '#0b0e14',
    title: 'Sectium Browser',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWin.loadFile(path.join(__dirname, 'chrome.html'));
  mainWin.on('resize', () => {
    layoutViewport();
    broadcastTabs();
  });
  mainWin.on('closed', () => {
    mainWin = null;
    tabs.clear();
    groups.clear();
    mountedViews.clear();
  });

  mainWin.webContents.once('did-finish-load', () => {
    for (const u of getInitialUrls()) createTab(u);
  });

  ipcMain.on('sectium:new-tab', (_e, url, groupId) => createTab(url || NEWTAB_URL, groupId ?? null));
  ipcMain.on('sectium:activate-tab', (_e, id) => activateTab(id));
  ipcMain.on('sectium:close-tab', (_e, id) => closeTab(id));
  ipcMain.on('sectium:navigate', (_e, raw) => {
    const tab = getFocusedTab();
    if (tab) tab.view.webContents.loadURL(normalizeUrl(raw)).catch(() => {});
  });
  ipcMain.on('sectium:back', () => {
    const tab = getFocusedTab();
    if (tab && tab.view.webContents.navigationHistory.canGoBack()) tab.view.webContents.navigationHistory.goBack();
  });
  ipcMain.on('sectium:forward', () => {
    const tab = getFocusedTab();
    if (tab && tab.view.webContents.navigationHistory.canGoForward()) tab.view.webContents.navigationHistory.goForward();
  });
  ipcMain.on('sectium:reload', () => {
    const tab = getFocusedTab();
    if (tab) tab.view.webContents.reload();
  });
  ipcMain.on('sectium:devtools', () => {
    const tab = getFocusedTab();
    if (tab) tab.view.webContents.toggleDevTools();
  });

  // Vertical sidebar, split tabs, and tab groups IPC
  ipcMain.on('sectium:toggle-sidebar', (_e, explicit) => {
    sidebarExpanded = typeof explicit === 'boolean' ? explicit : !sidebarExpanded;
    layoutViewport();
    broadcastTabs();
  });
  ipcMain.on('sectium:toggle-split', (_e, targetTabId) => toggleSplit(targetTabId));
  ipcMain.on('sectium:close-split', () => closeSplit());
  ipcMain.on('sectium:set-split-ratio', (_e, ratio) => {
    splitRatio = clampSplitRatio(ratio);
    layoutViewport();
    broadcastTabs();
  });
  ipcMain.on('sectium:focus-split-pane', (_e, pane) => {
    if (pane === 'secondary' && splitTabId != null) focusedPane = 'secondary';
    else focusedPane = 'primary';
    broadcastTabs();
  });
  ipcMain.on('sectium:create-group', (_e, title, tabId) => createGroup(title, tabId));
  ipcMain.on('sectium:toggle-group-collapse', (_e, groupId) => {
    const g = groups.get(groupId);
    if (!g) return;
    g.collapsed = !g.collapsed;
    broadcastTabs();
  });
  ipcMain.on('sectium:assign-tab-group', (_e, tabId, groupId) => {
    const tab = tabs.get(tabId);
    if (!tab) return;
    tab.groupId = groupId != null && groups.has(groupId) ? groupId : null;
    broadcastTabs();
  });
  ipcMain.on('sectium:delete-group', (_e, groupId) => {
    if (!groups.has(groupId)) return;
    groups.delete(groupId);
    for (const t of tabs.values()) {
      if (t.groupId === groupId) t.groupId = null;
    }
    broadcastTabs();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
