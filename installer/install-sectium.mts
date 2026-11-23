#!/usr/bin/env node
/**
 * @file intersections/sectium-browser/installer/install-sectium.mts
 * @description Real Windows End-User Installer for Sectium Browser (`D:\Sectium`).
 *
 * Installs the sovereign Sectium runtime payload, Sectium Canvas pure-art New Tab
 * extension, multi-resolution Lumi icon (`RT_GROUP_ICON #101`), Desktop & Start Menu
 * shortcuts, User PATH entry, Windows Apps & Features (Uninstall) registration,
 * App Paths (`Win+R -> sectium`), and Windows Default Browser Capabilities (`HKCU`).
 *
 * Usage:
 *   .\bin\sectium-install.ps1 [--dir D:\Sectium] [--source E:\b8g-chromium-real\src\out\B8gRelease]
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const WORKSPACE_ROOT = resolve(__dirname, '..', '..', '..');

const DEFAULT_SOURCE_DIR = 'E:\\b8g-chromium-real\\src\\out\\B8gRelease';
const DEFAULT_INSTALL_DIR = 'D:\\Sectium';
const SYSTEM_INSTALL_DIR = 'C:\\Program Files\\Sectium';
const SECTIUM_VERSION = '160.0.8177.0';
const INTEGRITY_MANIFEST_FILENAME = 'sectium-integrity.json';
const MAX_SHORTCUT_ARGS_LENGTH = 250;

const RUNTIME_EXES = new Set([
  'sectium.exe',
  'sectium-node.exe',
  'node.exe',
  'electron.exe',
  'nw.exe',
  'msedge.exe',
  'msedgewebview2.exe',
  'chromium.exe',
]);

const RUNTIME_EXTS = new Set(['.dll', '.pak', '.bin', '.dat', '.icc', '.manifest']);
const RUNTIME_JSON = new Set(['vk_swiftshader_icd.json']);
const RUNTIME_SUBDIRS = ['locales', 'MEIPreload', 'swiftshader'];

export interface InstallOptions {
  readonly sourceDir: string;
  readonly installDir: string;
  readonly hardened?: boolean;
  readonly devUnpackedExt?: boolean;
  readonly system?: boolean;
}

export interface InstallResult {
  readonly installDir: string;
  readonly filesCopied: number;
  readonly totalBytes: number;
  readonly desktopShortcut: string;
  readonly startMenuShortcut: string;
  readonly iconPath: string;
  readonly integrityManifestPath: string;
  readonly hardened: boolean;
  readonly devUnpackedExt: boolean;
}

export interface SafeShortcutArgsOptions {
  readonly profileDir: string;
  readonly extDir: string;
  readonly devUnpackedExt?: boolean;
}

export interface InstallIntegrityManifest {
  readonly schema: 'sectium-integrity-v1';
  readonly version: string;
  readonly algorithm: 'sha256';
  readonly generatedAt: string;
  readonly files: Record<string, string>;
}

export interface IntegrityVerificationResult {
  readonly ok: boolean;
  readonly checked: number;
  readonly tampered: string[];
  readonly missing: string[];
}

function formatFlagPath(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}

/**
 * Builds Windows .lnk / shell launch arguments for Sectium.
 *
 * Hardened default (`devUnpackedExt: false`) NEVER emits `--load-extension` or
 * `--disable-features=DisableLoadExtensionCommandLineSwitch`, eliminating the
 * unpacked-extension `.lnk` persistence vector.
 */
export function buildSafeShortcutArgs(opts: SafeShortcutArgsOptions): string {
  const devUnpackedExt = opts.devUnpackedExt === true;
  const args: string[] = [`--user-data-dir=${formatFlagPath(opts.profileDir)}`];
  const disabledFeatures = (
    devUnpackedExt
      ? ['DisableLoadExtensionCommandLineSwitch']
      : ['Translate', 'OptimizationGuideModelDownloading', 'BrowsingTopics']
  ).join(',');

  args.push('--disable-component-update');
  args.push(`--disable-features=${disabledFeatures}`);
  if (devUnpackedExt) {
    args.push(`--load-extension=${formatFlagPath(opts.extDir)}`);
  }

  args.push('--no-first-run', '--new-window');

  const launchArgs = args.join(' ');
  if (launchArgs.length > MAX_SHORTCUT_ARGS_LENGTH) {
    throw new Error(
      `[sectium-install] Preflight gate failed: shortcut Arguments length ${launchArgs.length} exceeds safe Windows .lnk limit (${MAX_SHORTCUT_ARGS_LENGTH})`,
    );
  }
  return launchArgs;
}

function hashFileSha256(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function collectFilesRecursive(dirPath: string, out: string[]): void {
  if (!existsSync(dirPath)) return;
  const entries = readdirSync(dirPath, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collectFilesRecursive(fullPath, out);
    } else if (entry.isFile()) {
      out.push(fullPath);
    }
  }
}

/**
 * Computes SHA-256 digests for `sectium.exe`, `chrome.dll`, and all files under
 * `resources/new-tab-extension/` and writes `<installDir>/sectium-integrity.json`.
 */
export function writeInstallIntegrityManifest(installDir: string): InstallIntegrityManifest {
  const root = resolve(installDir);
  const targets: string[] = [];

  for (const binName of ['sectium.exe', 'chrome.dll']) {
    const binPath = join(root, binName);
    if (existsSync(binPath)) {
      targets.push(binPath);
    }
  }

  const extRoot = join(root, 'resources', 'new-tab-extension');
  collectFilesRecursive(extRoot, targets);

  const entries: Array<[string, string]> = targets.map((absPath) => {
    const relKey = relative(root, absPath).replace(/\\/g, '/');
    return [relKey, hashFileSha256(absPath)];
  });
  entries.sort((a, b) => a[0].localeCompare(b[0]));

  const files: Record<string, string> = {};
  for (const [relKey, digest] of entries) {
    files[relKey] = digest;
  }

  const manifest: InstallIntegrityManifest = {
    schema: 'sectium-integrity-v1',
    version: SECTIUM_VERSION,
    algorithm: 'sha256',
    generatedAt: new Date().toISOString(),
    files,
  };

  writeFileSync(
    join(root, INTEGRITY_MANIFEST_FILENAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  return manifest;
}

/**
 * Recomputes SHA-256 for every entry in `<installDir>/sectium-integrity.json`
 * and reports any tampered or missing files.
 */
export function verifyInstallIntegrity(installDir: string): IntegrityVerificationResult {
  const root = resolve(installDir);
  const manifestPath = join(root, INTEGRITY_MANIFEST_FILENAME);
  if (!existsSync(manifestPath)) {
    return {
      ok: false,
      checked: 0,
      tampered: [],
      missing: [INTEGRITY_MANIFEST_FILENAME],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return {
      ok: false,
      checked: 0,
      tampered: [INTEGRITY_MANIFEST_FILENAME],
      missing: [],
    };
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('files' in parsed) ||
    !parsed.files ||
    typeof parsed.files !== 'object'
  ) {
    return {
      ok: false,
      checked: 0,
      tampered: [INTEGRITY_MANIFEST_FILENAME],
      missing: [],
    };
  }

  const filesMap = parsed.files as Record<string, unknown>;
  const tampered: string[] = [];
  const missing: string[] = [];
  let checked = 0;
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;

  for (const relKey of Object.keys(filesMap).sort()) {
    const expectedHash = filesMap[relKey];
    checked += 1;

    if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedHash)) {
      tampered.push(relKey);
      continue;
    }

    const absPath = resolve(root, relKey);
    if (!absPath.startsWith(rootPrefix)) {
      tampered.push(relKey);
      continue;
    }

    if (!existsSync(absPath)) {
      missing.push(relKey);
      continue;
    }

    const actualHash = hashFileSha256(absPath);
    if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
      tampered.push(relKey);
    }
  }

  return {
    ok: checked > 0 && tampered.length === 0 && missing.length === 0,
    checked,
    tampered,
    missing,
  };
}

function copyRuntimePayload(sourceDir: string, installDir: string): { filesCopied: number; totalBytes: number } {
  if (!existsSync(join(sourceDir, 'sectium.exe'))) {
    throw new Error(`Sectium build payload not found at ${sourceDir} (missing sectium.exe)`);
  }
  mkdirSync(installDir, { recursive: true });

  let filesCopied = 0;
  let totalBytes = 0;

  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const srcPath = join(sourceDir, entry.name);
    const dstPath = join(installDir, entry.name);

    if (entry.isFile()) {
      const lower = entry.name.toLowerCase();
      const ext = extname(lower);
      if (RUNTIME_EXES.has(lower) || RUNTIME_EXTS.has(ext) || RUNTIME_JSON.has(lower)) {
        const srcStat = statSync(srcPath);
        const needCopy =
          !existsSync(dstPath) ||
          statSync(dstPath).size !== srcStat.size ||
          statSync(dstPath).mtimeMs < srcStat.mtimeMs;
        if (needCopy) {
          copyFileSync(srcPath, dstPath);
        }
        filesCopied += 1;
        totalBytes += srcStat.size;
      }
    } else if (entry.isDirectory() && RUNTIME_SUBDIRS.includes(entry.name)) {
      cpSync(srcPath, dstPath, { recursive: true, force: true });
      for (const sub of readdirSync(dstPath, { withFileTypes: true })) {
        if (sub.isFile()) {
          filesCopied += 1;
          totalBytes += statSync(join(dstPath, sub.name)).size;
        }
      }
    }
  }

  return { filesCopied, totalBytes };
}

function ensureSectiumIcon(installDir: string): { iconPath: string; svgPath: string } {
  const assetsDir = join(installDir, 'assets');
  mkdirSync(assetsDir, { recursive: true });

  const cachedIco = join(WORKSPACE_ROOT, '.b8g-cas', 'sectium-brand-icons', 'win', 'sectium.ico');
  if (!existsSync(cachedIco)) {
    const cli = join(WORKSPACE_ROOT, 'sections', 'sectium-assets', 'cli.mts');
    const outDir = join(WORKSPACE_ROOT, '.b8g-cas', 'sectium-brand-icons');
    spawnSync(process.execPath, [cli, 'stamp', 'sectium', '--name', 'Sectium', '--out', outDir], {
      cwd: WORKSPACE_ROOT,
      stdio: 'inherit',
      shell: false,
    });
  }

  const iconPath = join(assetsDir, 'sectium.ico');
  const fallbackIco = join(WORKSPACE_ROOT, 'intersections', 'sectium-browser', 'brand-assets', 'lumi.ico');
  copyFileSync(existsSync(cachedIco) ? cachedIco : fallbackIco, iconPath);

  const svgSrc = join(WORKSPACE_ROOT, 'intersections', 'sectium-browser', 'brand-assets', 'sectium-logo-animation.svg');
  const svgPath = join(assetsDir, 'lumi.svg');
  if (existsSync(svgSrc)) {
    copyFileSync(svgSrc, svgPath);
  }

  // Stamp multi-res Lumi icon into D:\Sectium\sectium.exe ONLY.
  // NEVER run UpdateResourceW on 174 MB chrome.dll (breaks Chromium's delay-load directory 0xc06d007e);
  // chrome.dll icons are embedded at compile time via chrome/app/theme/chromium/win/chromium.ico.
  const stamper = join(WORKSPACE_ROOT, 'sections', 'sectium-assets', 'dist', 'pe-icon-stamp.exe');
  if (existsSync(stamper)) {
    const targetPath = join(installDir, 'sectium.exe');
    if (existsSync(targetPath)) {
      const res = spawnSync(stamper, [targetPath, iconPath], {
        encoding: 'utf8',
        windowsHide: true,
        shell: false,
      });
      if (res.status !== 0) {
        console.warn(`[sectium-install] Warning: pe-icon-stamp on sectium.exe returned ${res.status}: ${res.stderr}`);
      } else if (res.stdout.trim()) {
        console.log(res.stdout.trim());
      }
    }
  }

  return { iconPath, svgPath };
}

function installNewTabExtension(installDir: string): string {
  const srcExt = join(WORKSPACE_ROOT, 'intersections', 'sectium-browser', 'new-tab-extension');
  const dstExt = join(installDir, 'resources', 'new-tab-extension');
  mkdirSync(dstExt, { recursive: true });
  cpSync(srcExt, dstExt, { recursive: true, force: true });
  return dstExt;
}

function writeUninstaller(installDir: string): { ps1: string; cmd: string } {
  const ps1 = join(installDir, 'uninstall-sectium.ps1');
  const cmd = join(installDir, 'uninstall-sectium.cmd');

  const ps1Content = `# Sectium Browser End-User Uninstaller
$ErrorActionPreference = 'SilentlyContinue'
$InstallDir = "${installDir.replace(/\\/g, '\\\\')}"

Write-Host "[Sectium] Removing shortcuts and Windows registrations..." -ForegroundColor Cyan

# 1. Remove Desktop & Start Menu shortcuts
Remove-Item (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Sectium.lnk') -Force
Remove-Item (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\Sectium') -Recurse -Force

# 2. Remove HKCU Registry entries (Apps & Features, App Paths, Default Browser)
Remove-Item 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Sectium' -Recurse -Force
Remove-Item 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\sectium.exe' -Recurse -Force
Remove-Item 'HKCU:\\Software\\Clients\\StartMenuInternet\\Sectium' -Recurse -Force
Remove-Item 'HKCU:\\Software\\Classes\\SectiumHTML' -Recurse -Force
Remove-ItemProperty -Path 'HKCU:\\Software\\RegisteredApplications' -Name 'Sectium' -Force

# 3. Remove from User PATH
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath) {
  $filtered = ($userPath -split ';' | Where-Object { $_ -and $_.TrimEnd('\\') -ne $InstallDir.TrimEnd('\\') }) -join ';'
  [Environment]::SetEnvironmentVariable('Path', $filtered, 'User')
}

Write-Host "[Sectium] Uninstalled Windows integration. You may delete $InstallDir if any file was in use." -ForegroundColor Green
`;

  const cmdContent = `@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall-sectium.ps1"\r\n`;

  writeFileSync(ps1, ps1Content, 'utf8');
  writeFileSync(cmd, cmdContent, 'utf8');
  return { ps1, cmd };
}

function registerWindowsIntegration(
  installDir: string,
  iconPath: string,
  extDir: string,
  uninstallCmd: string,
  totalBytes: number,
  devUnpackedExt: boolean,
): { desktopShortcut: string; startMenuShortcut: string } {
  const estimatedKb = Math.max(1, Math.round(totalBytes / 1024));
  const sectiumExe = join(installDir, 'sectium.exe');
  const profileDir = join(installDir, 'profile');
  mkdirSync(profileDir, { recursive: true });
  const newTabUrl = `file:///${join(extDir, 'newtab.html').replace(/\\/g, '/')}`;
  writeFileSync(
    join(installDir, 'initial_preferences'),
    JSON.stringify(
      {
        homepage: newTabUrl,
        homepage_is_newtabpage: false,
        browser: { show_home_button: true },
        session: { restore_on_startup: 4, startup_urls: [newTabUrl] },
        translate: { enabled: false },
      },
      null,
      2,
    ),
    'utf8',
  );
  // Keep .lnk Arguments strictly <= 250 chars (Windows Shell silently breaks shortcuts > 260 chars!).
  // Hardened default omits --load-extension and DisableLoadExtensionCommandLineSwitch.
  const launchArgs = buildSafeShortcutArgs({ profileDir, extDir, devUnpackedExt });

  const psScript = `
$ErrorActionPreference = 'Stop'
$InstallDir = '${installDir.replace(/'/g, "''")}'
$SectiumExe = '${sectiumExe.replace(/'/g, "''")}'
$IconPath   = '${iconPath.replace(/'/g, "''")}'
$ExtDir     = '${extDir.replace(/'/g, "''")}'
$UninstallCmd = '${uninstallCmd.replace(/'/g, "''")}'
$LaunchArgs = '${launchArgs.replace(/'/g, "''")}'

# 1. User PATH (prepend D:\\Sectium cleanly without duplicates)
$curPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$parts = @($curPath -split ';' | Where-Object { $_ -and $_.Trim() -ne '' -and $_.TrimEnd('\\') -ne $InstallDir.TrimEnd('\\') })
$newPath = (@($InstallDir) + $parts) -join ';'
[Environment]::SetEnvironmentVariable('Path', $newPath, 'User')

# 2. Desktop Shortcut + Start Menu Shortcuts
$WshShell = New-Object -ComObject WScript.Shell
$DesktopLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Sectium.lnk'
$sc = $WshShell.CreateShortcut($DesktopLnk)
$sc.TargetPath = $SectiumExe
$sc.Arguments = $LaunchArgs
$sc.WorkingDirectory = $InstallDir
$sc.IconLocation = "$IconPath,0"
$sc.Description = 'Sectium Sovereign Browser (Awesome-OS)'
$sc.Save()

$StartMenuDir = Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\Sectium'
New-Item -ItemType Directory -Force -Path $StartMenuDir | Out-Null
$StartMenuLnk = Join-Path $StartMenuDir 'Sectium.lnk'
$sc2 = $WshShell.CreateShortcut($StartMenuLnk)
$sc2.TargetPath = $SectiumExe
$sc2.Arguments = $LaunchArgs
$sc2.WorkingDirectory = $InstallDir
$sc2.IconLocation = "$IconPath,0"
$sc2.Description = 'Sectium Sovereign Browser (Awesome-OS)'
$sc2.Save()

$UninstLnk = Join-Path $StartMenuDir 'Uninstall Sectium.lnk'
$sc3 = $WshShell.CreateShortcut($UninstLnk)
$sc3.TargetPath = $UninstallCmd
$sc3.WorkingDirectory = $InstallDir
$sc3.IconLocation = "$IconPath,0"
$sc3.Description = 'Uninstall Sectium Browser'
$sc3.Save()

# 3. Windows Apps & Features (HKCU Uninstall)
$UninstKey = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Sectium'
New-Item -Path $UninstKey -Force | Out-Null
Set-ItemProperty -Path $UninstKey -Name 'DisplayName' -Value 'Sectium Browser'
Set-ItemProperty -Path $UninstKey -Name 'DisplayVersion' -Value '${SECTIUM_VERSION}'
Set-ItemProperty -Path $UninstKey -Name 'Publisher' -Value 'Awesome-OS'
Set-ItemProperty -Path $UninstKey -Name 'DisplayIcon' -Value "$IconPath,0"
Set-ItemProperty -Path $UninstKey -Name 'InstallLocation' -Value $InstallDir
Set-ItemProperty -Path $UninstKey -Name 'UninstallString' -Value "\`"$UninstallCmd\`""
Set-ItemProperty -Path $UninstKey -Name 'URLInfoAbout' -Value 'https://awesome-os.com'
Set-ItemProperty -Path $UninstKey -Name 'EstimatedSize' -Value ${estimatedKb} -Type DWord
Set-ItemProperty -Path $UninstKey -Name 'NoModify' -Value 1 -Type DWord
Set-ItemProperty -Path $UninstKey -Name 'NoRepair' -Value 1 -Type DWord

# 4. App Paths (Win+R -> sectium)
$AppPathKey = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\sectium.exe'
New-Item -Path $AppPathKey -Force | Out-Null
Set-ItemProperty -Path $AppPathKey -Name '(Default)' -Value $SectiumExe
Set-ItemProperty -Path $AppPathKey -Name 'Path' -Value $InstallDir

# 5. Windows Default Browser Capabilities (StartMenuInternet + RegisteredApplications)
$ClientKey = 'HKCU:\\Software\\Clients\\StartMenuInternet\\Sectium'
New-Item -Path "$ClientKey\\DefaultIcon" -Force | Out-Null
New-Item -Path "$ClientKey\\shell\\open\\command" -Force | Out-Null
New-Item -Path "$ClientKey\\Capabilities\\FileAssociations" -Force | Out-Null
New-Item -Path "$ClientKey\\Capabilities\\URLAssociations" -Force | Out-Null
Set-ItemProperty -Path $ClientKey -Name '(Default)' -Value 'Sectium'
Set-ItemProperty -Path "$ClientKey\\DefaultIcon" -Name '(Default)' -Value "$IconPath,0"
Set-ItemProperty -Path "$ClientKey\\shell\\open\\command" -Name '(Default)' -Value "\`"$SectiumExe\`" $LaunchArgs"
Set-ItemProperty -Path "$ClientKey\\Capabilities" -Name 'ApplicationName' -Value 'Sectium'
Set-ItemProperty -Path "$ClientKey\\Capabilities" -Name 'ApplicationDescription' -Value 'Sovereign open-source browser by Awesome-OS'
Set-ItemProperty -Path "$ClientKey\\Capabilities" -Name 'ApplicationIcon' -Value "$IconPath,0"
Set-ItemProperty -Path "$ClientKey\\Capabilities\\FileAssociations" -Name '.htm' -Value 'SectiumHTML'
Set-ItemProperty -Path "$ClientKey\\Capabilities\\FileAssociations" -Name '.html' -Value 'SectiumHTML'
Set-ItemProperty -Path "$ClientKey\\Capabilities\\URLAssociations" -Name 'http' -Value 'SectiumHTML'
Set-ItemProperty -Path "$ClientKey\\Capabilities\\URLAssociations" -Name 'https' -Value 'SectiumHTML'

$ProgIdKey = 'HKCU:\\Software\\Classes\\SectiumHTML'
New-Item -Path "$ProgIdKey\\DefaultIcon" -Force | Out-Null
New-Item -Path "$ProgIdKey\\shell\\open\\command" -Force | Out-Null
Set-ItemProperty -Path $ProgIdKey -Name '(Default)' -Value 'Sectium HTML Document'
Set-ItemProperty -Path "$ProgIdKey\\DefaultIcon" -Name '(Default)' -Value "$IconPath,0"
Set-ItemProperty -Path "$ProgIdKey\\shell\\open\\command" -Name '(Default)' -Value "\`"$SectiumExe\`" $LaunchArgs \`"%1\`""

New-Item -Path 'HKCU:\\Software\\RegisteredApplications' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\\Software\\RegisteredApplications' -Name 'Sectium' -Value 'Software\\Clients\\StartMenuInternet\\Sectium\\Capabilities'

# 6. Notify Windows Shell to refresh Desktop / Start Menu icons & PATH immediately
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class ShellRefresh {
  [DllImport("shell32.dll")]
  public static extern void SHChangeNotify(int wEventId, int uFlags, IntPtr dwItem1, IntPtr dwItem2);
  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
  public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
}
"@
[ShellRefresh]::SHChangeNotify(0x08000000, 0x0000, [IntPtr]::Zero, [IntPtr]::Zero)
$res = [UIntPtr]::Zero
[ShellRefresh]::SendMessageTimeout([IntPtr]0xffff, 0x001A, [UIntPtr]::Zero, "Environment", 2, 2000, [ref]$res) | Out-Null

Write-Output "DESKTOP=$DesktopLnk"
Write-Output "STARTMENU=$StartMenuLnk"
`;

  const res = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
    { encoding: 'utf8', windowsHide: true, shell: false },
  );
  if (res.status !== 0) {
    throw new Error(`Windows integration failed (exit ${res.status}):\n${res.stderr}\n${res.stdout}`);
  }

  let desktopShortcut = '';
  let startMenuShortcut = '';
  for (const line of res.stdout.split(/\r?\n/)) {
    if (line.startsWith('DESKTOP=')) desktopShortcut = line.slice('DESKTOP='.length).trim();
    if (line.startsWith('STARTMENU=')) startMenuShortcut = line.slice('STARTMENU='.length).trim();
  }

  // Also write a clean D:\Sectium\sectium.cmd wrapper? Note: sectium.exe is already in D:\Sectium,
  // so typing `sectium` in cmd/pwsh invokes D:\Sectium\sectium.exe directly; we also provide
  // `sectium-open.cmd` with the full sovereign flags & Sectium Canvas New Tab extension.
  writeFileSync(
    join(installDir, 'sectium-open.cmd'),
    `@echo off\r\nset GOOGLE_API_KEY=no\r\nset GOOGLE_DEFAULT_CLIENT_ID=no\r\nset GOOGLE_DEFAULT_CLIENT_SECRET=no\r\nstart "" "%~dp0sectium.exe" ${launchArgs} %*\r\n`,
    'utf8',
  );

  return { desktopShortcut, startMenuShortcut };
}

export function installSectium(opts: Partial<InstallOptions> = {}): InstallResult {
  const hardened = opts.hardened ?? true;
  const devUnpackedExt = opts.devUnpackedExt ?? false;
  const defaultInstallDir = opts.system ? SYSTEM_INSTALL_DIR : DEFAULT_INSTALL_DIR;
  const sourceDir = resolve(opts.sourceDir ?? DEFAULT_SOURCE_DIR);
  const installDir = resolve(opts.installDir ?? defaultInstallDir);

  console.log(`[sectium-install] Copying runtime payload from ${sourceDir} -> ${installDir}...`);
  const { filesCopied, totalBytes } = copyRuntimePayload(sourceDir, installDir);

  console.log('[sectium-install] Installing Sectium Canvas pure-art New Tab extension...');
  const extDir = installNewTabExtension(installDir);

  console.log('[sectium-install] Installing & stamping multi-res Lumi icon...');
  const { iconPath } = ensureSectiumIcon(installDir);

  console.log('[sectium-install] Writing SHA-256 install integrity manifest...');
  writeInstallIntegrityManifest(installDir);
  const integrityManifestPath = join(installDir, INTEGRITY_MANIFEST_FILENAME);

  console.log('[sectium-install] Granting Windows AppContainer Sandbox Read+Execute ACLs...');
  spawnSync('icacls', [installDir, '/grant', '*S-1-15-2-1:(OI)(CI)(RX)', '/T', '/C', '/Q'], {
    windowsHide: true,
    shell: false,
  });
  spawnSync('icacls', [installDir, '/grant', '*S-1-5-32-545:(OI)(CI)(RX)', '/T', '/C', '/Q'], {
    windowsHide: true,
    shell: false,
  });

  console.log('[sectium-install] Writing uninstaller & registering Windows shell integration...');
  const { cmd: uninstallCmd } = writeUninstaller(installDir);
  const { desktopShortcut, startMenuShortcut } = registerWindowsIntegration(
    installDir,
    iconPath,
    extDir,
    uninstallCmd,
    totalBytes,
    devUnpackedExt,
  );

  return {
    installDir,
    filesCopied,
    totalBytes,
    desktopShortcut,
    startMenuShortcut,
    iconPath,
    integrityManifestPath,
    hardened,
    devUnpackedExt,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const dirIdx = args.indexOf('--dir');
  const srcIdx = args.indexOf('--source');
  const system = args.includes('--system');
  const devUnpackedExt = args.includes('--dev-unpacked-ext');
  const hardened = !args.includes('--no-hardened');
  const defaultDir = system ? SYSTEM_INSTALL_DIR : DEFAULT_INSTALL_DIR;
  const installDir = dirIdx >= 0 && args[dirIdx + 1] ? args[dirIdx + 1] : defaultDir;
  const sourceDir = srcIdx >= 0 && args[srcIdx + 1] ? args[srcIdx + 1] : DEFAULT_SOURCE_DIR;

  const result = installSectium({ sourceDir, installDir, hardened, devUnpackedExt, system });
  const mb = (result.totalBytes / (1024 * 1024)).toFixed(1);
  console.log(`[sectium-install] Installed Sectium ${SECTIUM_VERSION} -> ${result.installDir} (${result.filesCopied} files, ${mb} MB)`);
  console.log(`[sectium-install] Mode:                hardened=${result.hardened} devUnpackedExt=${result.devUnpackedExt}`);
  console.log(`[sectium-install] Integrity manifest:  ${result.integrityManifestPath}`);
  console.log(`[sectium-install] Desktop shortcut:    ${result.desktopShortcut}`);
  console.log(`[sectium-install] Start Menu shortcut: ${result.startMenuShortcut}`);
  console.log(`[sectium-install] Icon:                ${result.iconPath}`);
}
