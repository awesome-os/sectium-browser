import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  buildSafeShortcutArgs,
  verifyInstallIntegrity,
  writeInstallIntegrityManifest,
} from './install-sectium.mts';

describe('sectium-browser installer security hardening', () => {
  it('default hardened buildSafeShortcutArgs omits --load-extension and DisableLoadExtensionCommandLineSwitch and stays <= 250 chars', () => {
    const args = buildSafeShortcutArgs({
      profileDir: 'D:\\Sectium\\profile',
      extDir: 'D:\\Sectium\\resources\\new-tab-extension',
    });

    assert.equal(args.includes('--load-extension'), false, 'Hardened default must NEVER emit --load-extension');
    assert.equal(
      args.includes('DisableLoadExtensionCommandLineSwitch'),
      false,
      'Hardened default must NEVER emit DisableLoadExtensionCommandLineSwitch',
    );
    assert.ok(args.includes('--user-data-dir=D:\\Sectium\\profile'));
    assert.ok(args.includes('--disable-component-update'));
    assert.ok(
      args.includes(
        '--disable-features=Translate,OptimizationGuideModelDownloading,BrowsingTopics',
      ),
    );
    assert.ok(args.includes('--no-first-run'));
    assert.ok(args.includes('--new-window'));
    assert.ok(args.length <= 250, `Expected shortcut args <= 250 chars, got ${args.length}`);

    // Explicitly passing devUnpackedExt: false produces identical hardened output
    const explicitFalse = buildSafeShortcutArgs({
      profileDir: 'D:\\Sectium\\profile',
      extDir: 'D:\\Sectium\\resources\\new-tab-extension',
      devUnpackedExt: false,
    });
    assert.equal(explicitFalse, args);

    // Rejects overly long shortcut arguments that would silently break Windows .lnk files
    assert.throws(
      () =>
        buildSafeShortcutArgs({
          profileDir: `D:\\${'a'.repeat(240)}\\profile`,
          extDir: 'D:\\Sectium\\resources\\new-tab-extension',
        }),
      /exceeds safe Windows \.lnk limit/,
    );
  });

  it('--dev-unpacked-ext opt-in includes --load-extension cleanly and stays <= 250 chars', () => {
    const args = buildSafeShortcutArgs({
      profileDir: 'D:\\Sectium\\profile',
      extDir: 'D:\\Sectium\\resources\\new-tab-extension',
      devUnpackedExt: true,
    });

    assert.ok(args.includes('--disable-component-update'));
    assert.ok(args.includes('--disable-features=DisableLoadExtensionCommandLineSwitch'));
    assert.ok(args.includes('--load-extension=D:\\Sectium\\resources\\new-tab-extension'));
    assert.ok(args.includes('--user-data-dir=D:\\Sectium\\profile'));
    assert.ok(args.length <= 250, `Expected dev shortcut args <= 250 chars, got ${args.length}`);

    // System-wide install path with spaces is quoted safely and remains <= 250 chars
    const systemArgs = buildSafeShortcutArgs({
      profileDir: 'C:\\Program Files\\Sectium\\profile',
      extDir: 'C:\\Program Files\\Sectium\\resources\\new-tab-extension',
      devUnpackedExt: true,
    });
    assert.ok(systemArgs.includes('--user-data-dir="C:\\Program Files\\Sectium\\profile"'));
    assert.ok(
      systemArgs.includes('--load-extension="C:\\Program Files\\Sectium\\resources\\new-tab-extension"'),
    );
    assert.ok(
      systemArgs.length <= 250,
      `Expected system dev shortcut args <= 250 chars, got ${systemArgs.length}`,
    );
  });

  it('writeInstallIntegrityManifest + verifyInstallIntegrity passes on clean dir and detects byte-level tampering', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'sectium-integrity-'));
    try {
      const extDir = join(tempDir, 'resources', 'new-tab-extension');
      mkdirSync(extDir, { recursive: true });

      const sectiumExe = join(tempDir, 'sectium.exe');
      const chromeDll = join(tempDir, 'chrome.dll');
      const manifestJson = join(extDir, 'manifest.json');
      const newtabJs = join(extDir, 'newtab.js');

      writeFileSync(sectiumExe, Buffer.from('MZ-SECTIUM-TEST-BINARY-PAYLOAD-0001'));
      writeFileSync(chromeDll, Buffer.from('MZ-CHROME-DLL-TEST-PAYLOAD-0001'));
      writeFileSync(manifestJson, JSON.stringify({ manifest_version: 3, name: 'Sectium Canvas' }), 'utf8');
      writeFileSync(newtabJs, 'console.log("sectium-canvas-clean");\n', 'utf8');

      const manifest = writeInstallIntegrityManifest(tempDir);
      assert.equal(manifest.schema, 'sectium-integrity-v1');
      assert.equal(manifest.algorithm, 'sha256');
      assert.equal(Object.keys(manifest.files).length, 4);
      assert.ok(manifest.files['sectium.exe']);
      assert.ok(manifest.files['chrome.dll']);
      assert.ok(manifest.files['resources/new-tab-extension/manifest.json']);
      assert.ok(manifest.files['resources/new-tab-extension/newtab.js']);

      // 1. Clean install passes verification
      const clean = verifyInstallIntegrity(tempDir);
      assert.deepEqual(clean, {
        ok: true,
        checked: 4,
        tampered: [],
        missing: [],
      });

      // 2. Flip a single byte in chrome.dll -> immediately detected as tampered
      writeFileSync(chromeDll, Buffer.from('MZ-CHROME-DLL-TEST-PAYLOAD-0002'));
      const tamperedDll = verifyInstallIntegrity(tempDir);
      assert.equal(tamperedDll.ok, false);
      assert.equal(tamperedDll.checked, 4);
      assert.deepEqual(tamperedDll.tampered, ['chrome.dll']);
      assert.deepEqual(tamperedDll.missing, []);

      // 3. Also modify newtab.js -> both files flagged immediately
      writeFileSync(newtabJs, 'console.log("sectium-canvas-pwned");\n', 'utf8');
      const tamperedBoth = verifyInstallIntegrity(tempDir);
      assert.equal(tamperedBoth.ok, false);
      assert.equal(tamperedBoth.checked, 4);
      assert.deepEqual(tamperedBoth.tampered, [
        'chrome.dll',
        'resources/new-tab-extension/newtab.js',
      ]);
      assert.deepEqual(tamperedBoth.missing, []);

      // 4. Delete manifest.json -> reported in missing
      unlinkSync(manifestJson);
      const withMissing = verifyInstallIntegrity(tempDir);
      assert.equal(withMissing.ok, false);
      assert.deepEqual(withMissing.missing, ['resources/new-tab-extension/manifest.json']);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
