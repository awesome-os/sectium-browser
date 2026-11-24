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

const CHROME_HEIGHT = 44;
const NEWTAB_URL = pathToFileURL(path.join(__dirname, 'newtab', 'newtab.html')).href;
const SEARCH_PAGE_URL = pathToFileURL(path.join(__dirname, 'search', 'search.html')).href;
const SEARCH_PRELOAD_PATH = path.join(__dirname, 'search', 'preload.js');

const atlasSearch = new AtlasKvSearchEngine();

let mainWin = null;
const tabs = new Map();
let activeTabId = null;
let nextTabId = 1;

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
  // Direct Google web search shortcut (!g <query> or g <query>)
  if (/^(!g|g)\s+/i.test(s)) {
    return buildGoogleSearchUrl(s.replace(/^(!g|g)\s+/i, ''));
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) return s;
  if (/^localhost(:\d+)?(\/|$)/i.test(s) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(s)) {
    return 'http://' + s;
  }
  if (/^[^\s]+\.[^\s]{2,}$/.test(s)) return 'https://' + s;

  // Sovereign AtlasKV search first: if we have strong local/CAS/history matches, open
  // Sectium AtlasKV Search; otherwise fall back directly to nudge-free Google Search.
  const local = atlasSearch.search(s, 5);
  if (local.results.length > 0 && local.results[0].score >= 0.45) {
    return buildAtlasSearchUrl(s);
  }
  return buildGoogleSearchUrl(s);
}

function layoutActiveTab() {
  if (!mainWin || activeTabId == null) return;
  const tab = tabs.get(activeTabId);
  if (!tab) return;
  const [w, h] = mainWin.getContentSize();
  tab.view.setBounds({ x: 0, y: CHROME_HEIGHT, width: Math.max(1, w), height: Math.max(1, h - CHROME_HEIGHT) });
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
      active: id === activeTabId,
      loading: t.loading,
      canGoBack: t.view.webContents.navigationHistory.canGoBack(),
      canGoForward: t.view.webContents.navigationHistory.canGoForward(),
    });
  }
  mainWin.webContents.send('sectium:tabs', {
    tabs: list,
    activeId: activeTabId,
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
  if (activeTabId != null && tabs.has(activeTabId) && activeTabId !== id) {
    mainWin.contentView.removeChildView(tabs.get(activeTabId).view);
  }
  activeTabId = id;
  const tab = tabs.get(id);
  mainWin.contentView.addChildView(tab.view);
  layoutActiveTab();
  mainWin.setTitle((tab.title ? tab.title + ' — ' : '') + 'Sectium Browser');
  broadcastTabs();
}

function injectGoogleNudgeBlockerIfNeeded(wc, url) {
  if (isGoogleHost(url)) {
    wc.insertCSS(GOOGLE_NUDGE_HIDE_CSS).catch(() => {});
  }
}

function createTab(initialUrl) {
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
  const tab = { id, view, title: 'New Tab', url: target, loading: true };
  tabs.set(id, tab);

  wc.on('page-title-updated', (_ev, title) => {
    tab.title = title || 'Sectium';
    atlasSearch.recordVisit(tab.url, tab.title);
    if (id === activeTabId && mainWin) mainWin.setTitle(tab.title + ' — Sectium Browser');
    broadcastTabs();
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
    createTab(url);
    return { action: 'deny' };
  });

  wc.loadURL(target).catch(() => {});
  activateTab(id);
  return id;
}

function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  if (mainWin && activeTabId === id) {
    mainWin.contentView.removeChildView(tab.view);
  }
  try { tab.view.webContents.close(); } catch {}
  tabs.delete(id);
  if (tabs.size === 0) {
    if (mainWin) mainWin.close();
    return;
  }
  if (activeTabId === id) {
    const lastId = Array.from(tabs.keys()).pop();
    activeTabId = null;
    activateTab(lastId);
  } else {
    broadcastTabs();
  }
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

  // Strip Electron/Sectium tokens from default session UA & block Google Chrome-install callouts
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
  mainWin.on('resize', layoutActiveTab);
  mainWin.on('closed', () => {
    mainWin = null;
    tabs.clear();
  });

  mainWin.webContents.once('did-finish-load', () => {
    for (const u of getInitialUrls()) createTab(u);
  });

  ipcMain.on('sectium:new-tab', (_e, url) => createTab(url || NEWTAB_URL));
  ipcMain.on('sectium:activate-tab', (_e, id) => activateTab(id));
  ipcMain.on('sectium:close-tab', (_e, id) => closeTab(id));
  ipcMain.on('sectium:navigate', (_e, raw) => {
    const tab = tabs.get(activeTabId);
    if (tab) tab.view.webContents.loadURL(normalizeUrl(raw)).catch(() => {});
  });
  ipcMain.on('sectium:back', () => {
    const tab = tabs.get(activeTabId);
    if (tab && tab.view.webContents.navigationHistory.canGoBack()) tab.view.webContents.navigationHistory.goBack();
  });
  ipcMain.on('sectium:forward', () => {
    const tab = tabs.get(activeTabId);
    if (tab && tab.view.webContents.navigationHistory.canGoForward()) tab.view.webContents.navigationHistory.goForward();
  });
  ipcMain.on('sectium:reload', () => {
    const tab = tabs.get(activeTabId);
    if (tab) tab.view.webContents.reload();
  });
  ipcMain.on('sectium:devtools', () => {
    const tab = tabs.get(activeTabId);
    if (tab) tab.view.webContents.toggleDevTools();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
