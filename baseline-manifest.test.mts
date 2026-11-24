import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildRollingReleaseManifest, buildUnifiedGhostIndex } from './baseline-manifest.mts';

test('buildRollingReleaseManifest assembles and verifies all required baseline roles', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sectium-baseline-test-'));
  try {
    writeFileSync(join(dir, 'v8-shared-win64.b8p'), 'v8-pack-bytes');
    writeFileSync(join(dir, 'sectium-shell-win64.b8p'), 'shell-pack-bytes');
    writeFileSync(join(dir, 'bun-neon-v8.exe'), 'bun-neon-bytes');
    writeFileSync(join(dir, 'libsectium_display.dll'), 'display-dll-bytes');
    writeFileSync(join(dir, 'b8g-shim.exe'), 'shim-exe-bytes');
    writeFileSync(join(dir, '01-browser-split-shell.exe'), 'shell-gui-bytes');
    writeFileSync(join(dir, 'lumi-white-dragon.ico'), 'lumi-ico-bytes');
    writeFileSync(join(dir, 'lumi-white-dragon-brand-pack.tar.gz'), 'lumi-pack-bytes');

    const { manifest, sha256Sums } = buildRollingReleaseManifest({
      distDir: dir,
      baselineTag: 'v0.5.0-baseline',
      previousTag: 'v0.4.0-components',
      componentsTag: 'v0.4.0-components',
      gravityTag: 'v0.5.0-gravity',
      displayTag: 'v0.4.0',
    });

    assert.equal(manifest.schema, 'sectium-baseline-v1');
    assert.equal(manifest.brand.mascot, 'Lumi White Dragon');
    assert.equal(manifest.brand.replaces_chromium_appearance, true);
    assert.equal(manifest.baseline_tag, 'v0.5.0-baseline');
    assert.equal(manifest.previous_tag, 'v0.4.0-components');
    assert.equal(manifest.chromium_baseline.is_component_build, true);
    assert.equal(manifest.chromium_baseline.build_with_tflite_lib, false);
    assert.equal(manifest.components.length, 8);
    assert.ok(sha256Sums.includes('v8-shared-win64.b8p'));
    assert.ok(sha256Sums.includes('lumi-white-dragon.ico'));

    // Verify cross-repo unified ghost-index.json merger
    writeFileSync(
      join(dir, 'ghost-5os-manifest.json'),
      JSON.stringify({
        libs: [
          {
            filename: 'libbrotli-wasm32-wasi.wasm',
            sha256: 'a'.repeat(64),
            download_url: 'https://github.com/awesome-os/upstream-mirrors/releases/download/v0.2.0-holo-5os/libbrotli-wasm32-wasi.wasm',
          },
        ],
      })
    );
    writeFileSync(
      join(dir, 'ghost-toolchains-manifest.json'),
      JSON.stringify({
        toolchains: [
          {
            filename: 'ghost-zig-0.14.0-win64.zip',
            sha256: 'b'.repeat(64),
            download_url: 'https://github.com/awesome-os/upstream-mirrors/releases/download/v0.1.0-ghost-toolchains/ghost-zig-0.14.0-win64.zip',
          },
        ],
      })
    );
    const idx = buildUnifiedGhostIndex(dir, manifest);
    assert.equal(idx.schema, 'b8g-ghost-unified-index-v1');
    assert.equal(idx.total_entries, 10);
    assert.equal(idx.entries['libbrotli-wasm32-wasi.wasm']?.category, 'holo-5os');
    assert.equal(idx.entries['ghost-zig-0.14.0-win64.zip']?.category, 'toolchain');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildRollingReleaseManifest rejects incomplete baselines missing required roles', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sectium-baseline-bad-'));
  try {
    writeFileSync(join(dir, 'b8g-shim.exe'), 'shim-only');
    assert.throws(
      () =>
        buildRollingReleaseManifest({
          distDir: dir,
          baselineTag: 'v0.5.0-baseline',
          previousTag: 'v0.4.0-components',
          componentsTag: 'v0.4.0-components',
          gravityTag: 'v0.5.0-gravity',
          displayTag: 'v0.4.0',
        }),
      /missing required component role/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
