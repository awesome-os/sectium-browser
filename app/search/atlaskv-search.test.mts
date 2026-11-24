import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, '..');

const {
  AtlasKvSearchEngine,
  GOOGLE_NUDGE_BLOCK_PATTERNS,
  GOOGLE_NUDGE_HIDE_CSS,
  buildCleanChromeUserAgent,
  buildGoogleSearchUrl,
  isGoogleHost,
  kg2kvEncode,
} = require('./atlaskv-search.js');

describe('Sectium AtlasKV Search & Nudge-Free Google', () => {
  it('contains zero DuckDuckGo references anywhere in app/', () => {
    const filesToCheck = [
      path.join(APP_DIR, 'main.js'),
      path.join(APP_DIR, 'newtab', 'newtab.js'),
      path.join(APP_DIR, 'search', 'atlaskv-search.js'),
      path.join(APP_DIR, 'search', 'search.html'),
    ];
    for (const f of filesToCheck) {
      const content = fs.readFileSync(f, 'utf8').toLowerCase();
      assert.equal(content.includes('duckduckgo.com'), false, `Found duckduckgo.com in ${f}`);
    }
  });

  it('produces L2-normalized KG2KV vectors and ranks local ecosystem & history matches', () => {
    const vec = kg2kvEncode('awesome-os sectium browser');
    assert.equal(vec.length, 128);
    let normSq = 0;
    for (let i = 0; i < vec.length; i += 1) normSq += vec[i] * vec[i];
    assert.ok(Math.abs(normSq - 1) < 1e-4, `Expected unit L2 norm, got ${normSq}`);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sectium-atlaskv-'));
    try {
      const engine = new AtlasKvSearchEngine({ casDir: tmpDir });
      const res = engine.search('godot game engine');
      assert.equal(res.engine, 'atlaskv');
      assert.equal(res.fallbackEngine, 'google');
      assert.equal(res.googleUrl, 'https://www.google.com/search?q=godot%20game%20engine');
      assert.ok(res.results.length >= 1);
      assert.match(res.results[0].url, /awesome-os\/godot/);

      engine.recordVisit('https://example.org/zig-compiler', 'Zig Cross-Compilation Guide');
      const histRes = engine.search('zig cross compilation');
      assert.ok(histRes.results.some((r: { url: string }) => r.url === 'https://example.org/zig-compiler'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('builds clean Google Search URLs and strips Electron/Sectium tokens from User-Agent', () => {
    assert.equal(buildGoogleSearchUrl('hello world'), 'https://www.google.com/search?q=hello%20world');

    const rawUa =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) sectium-browser/0.7.2 Chrome/142.0.0.0 Electron/47.0.0 Safari/537.36';
    const clean = buildCleanChromeUserAgent(rawUa);
    assert.equal(clean.includes('Electron/'), false);
    assert.equal(clean.includes('sectium-browser/'), false);
    assert.equal(clean.includes('Chrome/142.0.0.0'), true);
  });

  it('detects Google domains and provides Chrome-nudge network & CSS blockers', () => {
    assert.equal(isGoogleHost('https://www.google.com/search?q=test'), true);
    assert.equal(isGoogleHost('https://www.google.de/search?q=test'), true);
    assert.equal(isGoogleHost('https://github.com/awesome-os'), false);
    assert.ok(GOOGLE_NUDGE_BLOCK_PATTERNS.some((p: string) => p.includes('ogs.google.com/widget/callout')));
    assert.ok(GOOGLE_NUDGE_HIDE_CSS.includes('iframe[name="callout"]'));
  });
});
