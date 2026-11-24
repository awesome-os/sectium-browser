'use strict';

/**
 * @file app/search/atlaskv-search.js
 * @description Sovereign AtlasKV (`KG2KV` FNV-1a L2-normalized vector + lexical hybrid)
 * local search engine for Sectium Browser with nudge-free Google web search fallback.
 *
 * Zero DuckDuckGo. Zero external telemetry. Runs in < 5 ms over local history,
 * Awesome-OS ecosystem entries, and live `~/.b8g/cas/index.json` blobs.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const VECTOR_DIM = 128;
const MAX_HISTORY_ITEMS = 2000;

const GOOGLE_SEARCH_BASE = 'https://www.google.com/search?q=';

const BUILTIN_CORPUS = [
  { id: 'ao-home', title: 'Awesome-OS & Sectium — Sovereign OS', url: 'https://github.com/awesome-os/awesome-os', kind: 'ecosystem', tags: 'awesome-os sectium holo-compiler b8g-ghost architecture readme' },
  { id: 'ao-site', title: 'awesome-os.com — Official Site & White Dragon Book', url: 'https://awesome-os.com', kind: 'ecosystem', tags: 'website docs blog book demos' },
  { id: 'ao-b8g', title: 'b8g.app — B8G App & Builder', url: 'https://b8g.app', kind: 'ecosystem', tags: 'b8g app builder games 3d' },
  { id: 'ao-cas', title: 'awesome-os/b8g-ghost — Canonical O(1) Ghost CAS (cas-v1)', url: 'https://github.com/awesome-os/b8g-ghost', kind: 'ecosystem', tags: 'cas b8g-ghost manifests index.json binaries' },
  { id: 'ao-browser', title: 'awesome-os/sectium-browser — Sovereign Chromium 158+ Browser', url: 'https://github.com/awesome-os/sectium-browser', kind: 'ecosystem', tags: 'sectium browser chromium v8 atlaskv search' },
  { id: 'ao-code', title: 'awesome-os/code-oss — Telemetry-Free Awesome-OS Code - OSS', url: 'https://github.com/awesome-os/code-oss', kind: 'ecosystem', tags: 'code-oss ide vscode editor typescript' },
  { id: 'ao-theia', title: 'awesome-os/theia — Eclipse Theia over Sectium & Ghost CAS', url: 'https://github.com/awesome-os/theia', kind: 'ecosystem', tags: 'theia ide open-vsx extensions' },
  { id: 'ao-ts', title: 'awesome-os/typescript — Wave 1+2 TypeScript 6.0.3 (14.3x Zero-AST CAS)', url: 'https://github.com/awesome-os/typescript', kind: 'ecosystem', tags: 'typescript compiler ts 6.0.3 fast' },
  { id: 'ao-stealify-ext', title: 'awesome-os/stealifylang-vscode — StealifyLang LSP, stealify-lint & Rules', url: 'https://github.com/awesome-os/stealifylang-vscode', kind: 'ecosystem', tags: 'stealifylang lint lsp rules vscode extension' },
  { id: 'ao-godot', title: 'awesome-os/godot & godot-vscode — Rolling Godot 4.7.2 + IDE Extension', url: 'https://github.com/awesome-os/godot', kind: 'ecosystem', tags: 'godot game engine gdscript csharp' },
  { id: 'ao-unreal', title: 'awesome-os/unreal-vscode — Zero-VS Unreal Engine 5 UBT + libunreal', url: 'https://github.com/awesome-os/unreal-vscode', kind: 'ecosystem', tags: 'unreal engine ue5 ubt game dev' },
  { id: 'ao-blender', title: 'awesome-os/blender & blender-vscode — Debloated Blender 5.3.0', url: 'https://github.com/awesome-os/blender', kind: 'ecosystem', tags: 'blender 3d bpy viewport' },
  { id: 'ao-obs', title: 'awesome-os/obs & obs-vscode — Portable OBS Studio 33.0.3', url: 'https://github.com/awesome-os/obs', kind: 'ecosystem', tags: 'obs studio streaming recording overlay' },
  { id: 'ao-t2linux', title: 'awesome-os/t2linux — Bootable UEFI/BIOS ISO & QCOW2', url: 'https://github.com/awesome-os/t2linux', kind: 'ecosystem', tags: 't2linux linux iso qcow2 os' },
  { id: 'ao-t2xnu', title: 'awesome-os/t2xnu — ARM64 Linux 7.0 + xnulinux Darwin Personality', url: 'https://github.com/awesome-os/t2xnu', kind: 'ecosystem', tags: 't2xnu macos darwin arm64 kernel' },
  { id: 'ao-t2desktop', title: 'awesome-os/t2desktop — Sovereign Omarchy Hyprland/Wayland Desktop', url: 'https://github.com/awesome-os/t2desktop', kind: 'ecosystem', tags: 't2desktop omarchy hyprland wayland lumi' },
  { id: 'ao-docker', title: 'awesome-os/dockerimages — 2.1 MB FROM scratch Multi-Arch OCI Images', url: 'https://github.com/awesome-os/dockerimages', kind: 'ecosystem', tags: 'docker oci container ghcr scratch' },
  { id: 'ao-runtimes', title: 'awesome-os/node · dotnet · powershell — Zero-Installer 5-Target Runtimes', url: 'https://github.com/awesome-os/node', kind: 'ecosystem', tags: 'node dotnet powershell runtime cli' },
];

function hashFnv1a32(str, seed = 0x811c9dc5) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9_.-]+/)
    .filter((t) => t.length > 0);
}

/**
 * AtlasKV KG2KV deterministic feature-hash encoder -> L2-normalized Float32Array.
 */
function kg2kvEncode(text, dim = VECTOR_DIM) {
  const vec = new Float32Array(dim);
  const tokens = tokenize(text);
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    const h1 = hashFnv1a32(tok, 0x811c9dc5);
    const h2 = hashFnv1a32(tok, 0x9e3779b9);
    const idx1 = h1 % dim;
    const idx2 = h2 % dim;
    vec[idx1] += (h1 & 1) === 0 ? 1 : -1;
    vec[idx2] += (h2 & 1) === 0 ? 0.5 : -0.5;
  }
  let normSq = 0;
  for (let d = 0; d < dim; d += 1) normSq += vec[d] * vec[d];
  const inv = normSq > 1e-12 ? 1 / Math.sqrt(normSq) : 0;
  for (let d = 0; d < dim; d += 1) vec[d] *= inv;
  return vec;
}

function dotVec(a, b) {
  let acc = 0;
  for (let i = 0; i < a.length; i += 1) acc += a[i] * b[i];
  return acc;
}

function getCasDir() {
  return process.env.B8G_GHOST_CACHE_DIR || process.env.B8G_GHOST_CAS_DIR || path.join(os.homedir(), '.b8g', 'cas');
}

function buildGoogleSearchUrl(query) {
  return GOOGLE_SEARCH_BASE + encodeURIComponent(String(query || '').trim());
}

/**
 * Strips Electron/Sectium tokens from a Chromium User-Agent so Google Search
 * recognizes standard Chromium and does NOT show "Switch to Chrome" install nudges.
 */
function buildCleanChromeUserAgent(rawUa) {
  const cleaned = String(rawUa || '')
    .replace(/\s+Electron\/[^\s]+/gi, '')
    .replace(/\s+sectium-browser\/[^\s]+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (cleaned) return cleaned;
  const chromeVer = (process.versions && process.versions.chrome) || '134.0.0.0';
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`;
}

/**
 * URL patterns for Google's "Switch to Chrome" / "Install Chrome" promo callout widgets.
 */
const GOOGLE_NUDGE_BLOCK_PATTERNS = [
  '*://ogs.google.com/widget/callout*',
  '*://*.google.com/async/bgasy*',
  '*://*.google.com/chrome/static/*',
];

/**
 * CSS injected into *.google.* pages to hide any residual Chrome-install nudge banners
 * while leaving all actual search results untouched.
 */
const GOOGLE_NUDGE_HIDE_CSS = [
  'iframe[name="callout"],',
  'iframe[src*="ogs.google.com/widget/callout"],',
  '#promos,',
  '.gb_callout,',
  '[data-ogpc],',
  'div[role="dialog"][aria-label*="Chrome" i],',
  'div[data-hveid]:has(> a[href*="google.com/chrome"]) {',
  '  display: none !important;',
  '  visibility: hidden !important;',
  '  pointer-events: none !important;',
  '}',
].join('\n');

function isGoogleHost(urlStr) {
  try {
    const u = new URL(urlStr);
    return /(^|\.)google\.[a-z.]+$/i.test(u.hostname);
  } catch {
    return false;
  }
}

class AtlasKvSearchEngine {
  constructor(options = {}) {
    this.casDir = options.casDir || getCasDir();
    this.historyFile = options.historyFile || path.join(this.casDir, 'sectium-atlaskv-history.json');
    this.entries = new Map();
    this._loadBuiltin();
    this._loadCasIndex();
    this._loadHistory();
  }

  _upsert(entry) {
    const text = `${entry.title || ''} ${entry.url || ''} ${entry.tags || ''} ${entry.kind || ''}`;
    this.entries.set(entry.url || entry.id, {
      id: entry.id || entry.url,
      title: entry.title || entry.url,
      url: entry.url,
      kind: entry.kind || 'history',
      tags: entry.tags || '',
      visits: entry.visits || 1,
      updatedAt: entry.updatedAt || Date.now(),
      vec: kg2kvEncode(text),
      searchText: text.toLowerCase(),
    });
  }

  _loadBuiltin() {
    for (const item of BUILTIN_CORPUS) {
      this._upsert(item);
    }
  }

  _loadCasIndex() {
    try {
      const idxPath = path.join(this.casDir, 'index.json');
      if (!fs.existsSync(idxPath)) return;
      const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
      const entries = idx && idx.entries ? Object.entries(idx.entries) : [];
      for (const [key, val] of entries) {
        if (!val || !val.download_url) continue;
        this._upsert({
          id: `cas:${key}`,
          title: `${key}${val.version ? ` (${val.version})` : ''} — b8g-ghost cas-v1`,
          url: val.download_url,
          kind: 'cas-v1',
          tags: `b8g-ghost cas ${val.category || ''} ${val.version || ''} ${key}`,
        });
      }
    } catch {
      // Non-fatal if CAS index not hydrated yet
    }
  }

  _loadHistory() {
    try {
      if (!fs.existsSync(this.historyFile)) return;
      const arr = JSON.parse(fs.readFileSync(this.historyFile, 'utf8'));
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (item && item.url) this._upsert(item);
        }
      }
    } catch {
      // Ignore corrupt history file
    }
  }

  _persistHistory() {
    try {
      fs.mkdirSync(path.dirname(this.historyFile), { recursive: true });
      const historyOnly = [];
      for (const item of this.entries.values()) {
        if (item.kind === 'history') {
          historyOnly.push({
            id: item.id,
            title: item.title,
            url: item.url,
            kind: 'history',
            tags: item.tags,
            visits: item.visits,
            updatedAt: item.updatedAt,
          });
        }
      }
      historyOnly.sort((a, b) => b.updatedAt - a.updatedAt);
      const trimmed = historyOnly.slice(0, MAX_HISTORY_ITEMS);
      const tmp = `${this.historyFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(trimmed, null, 2), 'utf8');
      fs.renameSync(tmp, this.historyFile);
    } catch {
      // Non-fatal
    }
  }

  recordVisit(url, title) {
    if (!url || !/^https?:\/\//i.test(url)) return;
    if (isGoogleHost(url) && url.includes('/search?')) return;
    const prev = this.entries.get(url);
    if (prev && prev.kind !== 'history') return;
    this._upsert({
      id: url,
      title: title || prev?.title || url,
      url,
      kind: 'history',
      tags: prev?.tags || '',
      visits: (prev?.visits || 0) + 1,
      updatedAt: Date.now(),
    });
    this._persistHistory();
  }

  search(query, limit = 12) {
    const q = String(query || '').trim();
    const googleUrl = buildGoogleSearchUrl(q);
    if (!q) {
      return { query: q, engine: 'atlaskv', fallbackEngine: 'google', googleUrl, totalIndexed: this.entries.size, results: [] };
    }
    const qVec = kg2kvEncode(q);
    const qLower = q.toLowerCase();
    const qTokens = tokenize(q);

    const scored = [];
    for (const item of this.entries.values()) {
      const cos = dotVec(qVec, item.vec);
      let lex = 0;
      if (item.searchText.includes(qLower)) lex += 0.65;
      if (qTokens.length > 0) {
        let matched = 0;
        for (const t of qTokens) {
          if (item.searchText.includes(t)) matched += 1;
        }
        lex += 0.45 * (matched / qTokens.length);
      }
      const score = cos * 0.55 + lex;
      if (score >= 0.22) {
        scored.push({
          id: item.id,
          title: item.title,
          url: item.url,
          kind: item.kind,
          score: Number(score.toFixed(4)),
          visits: item.visits,
        });
      }
    }

    scored.sort((a, b) => b.score - a.score || b.visits - a.visits);
    return {
      query: q,
      engine: 'atlaskv',
      fallbackEngine: 'google',
      googleUrl,
      totalIndexed: this.entries.size,
      results: scored.slice(0, limit),
    };
  }
}

module.exports = {
  AtlasKvSearchEngine,
  GOOGLE_NUDGE_BLOCK_PATTERNS,
  GOOGLE_NUDGE_HIDE_CSS,
  GOOGLE_SEARCH_BASE,
  buildCleanChromeUserAgent,
  buildGoogleSearchUrl,
  isGoogleHost,
  kg2kvEncode,
};
