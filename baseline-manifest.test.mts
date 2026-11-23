import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildRollingReleaseManifest } from './baseline-manifest.mts';

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
