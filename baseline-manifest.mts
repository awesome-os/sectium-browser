import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface GhostIndexEntry {
  filename: string;
  sha256: string;
  cas_key: string;
  category: 'baseline' | 'shard' | 'holo-5os' | 'toolchain';
  source_manifest: string;
  download_url: string;
}

export interface UnifiedGhostIndex {
  schema: 'b8g-ghost-unified-index-v1';
  baseline_tag: string;
  generated_at: string;
  cas_layout: '<cas>/<sha256>/<filename>';
  total_entries: number;
  entries: Record<string, GhostIndexEntry>;
}

export interface BaselineComponentEntry {
  filename: string;
  role: 'substrate' | 'runtime' | 'display' | 'shim' | 'shell' | 'brand' | 'profile';
  source_repo: string;
  source_tag: string;
  bytes: number;
  sha256: string;
  download_url: string;
}

export interface RollingReleaseManifest {
  schema: 'sectium-baseline-v1';
  baseline_tag: string;
  previous_tag: string;
  generated_at: string;
  brand: {
    product_name: 'Sectium Browser';
    mascot: 'Lumi White Dragon';
    replaces_chromium_appearance: true;
    icon_file: 'lumi-white-dragon.ico';
    brand_pack: 'lumi-white-dragon-brand-pack.tar.gz';
    overlay_file: 'chromium-brand-overlay.json';
  };
  chromium_baseline: {
    milestone: string;
    v8_version: string;
    is_component_build: boolean;
    build_with_tflite_lib: boolean;
  };
  abi: {
    control_plane: 'B8G_ABI_MAGIC_V3';
    display: 'B8G_DISPLAY_V1';
    arena: 'B8G_ARENA_V1';
  };
  components: BaselineComponentEntry[];
  downstream_contract: {
    v8_shared_pack: string;
    display_abi_lib: string;
    native_shim: string;
    runtime_binary: string;
    ghost_registry: {
      schema: 'b8g-ghost-registry-v1';
      cas_layout: 'v11/files/<sha512[:2]>/<sha512>';
      ghost_release_repo: 'awesome-os/holo-v11';
      shards_manifest: 'ghost-shards-manifest.json';
      unified_index: 'ghost-index.json';
      max_version_lock: string;
    };
  };
}

export function classifyArtifact(
  filename: string,
  tags: { components: string; gravity: string; display: string },
  baselineTag: string
): { role: BaselineComponentEntry['role']; source_repo: string; source_tag: string } {
  if (filename.endsWith('.b8p')) {
    return { role: 'substrate', source_repo: 'awesome-os/sectium-distributions', source_tag: tags.components };
  }
  if (filename === 'bun-neon-v8.exe') {
    return { role: 'runtime', source_repo: 'awesome-os/sectium-distributions', source_tag: tags.components };
  }
  if (filename.startsWith('libsectium_display') || filename === 'sectium_display.lib') {
    return { role: 'display', source_repo: 'awesome-os/holo-compiler', source_tag: tags.gravity };
  }
  if (filename.startsWith('b8g-shim')) {
    return { role: 'shim', source_repo: 'awesome-os/holo-compiler', source_tag: tags.gravity };
  }
  if (/^0[1-8]-.*\.exe$/i.test(filename)) {
    return { role: 'shell', source_repo: 'awesome-os/sectium-display', source_tag: tags.display };
  }
  if (filename.startsWith('lumi-white-dragon') || filename === 'chromium-brand-overlay.json') {
    return { role: 'brand', source_repo: 'awesome-os/sectium-browser', source_tag: baselineTag };
  }
  return { role: 'profile', source_repo: 'awesome-os/sectium-browser', source_tag: baselineTag };
}

export function sha256File(filePath: string): string {
  const h = createHash('sha256');
  h.update(readFileSync(filePath));
  return h.digest('hex');
}

export function buildRollingReleaseManifest(opts: {
  distDir: string;
  baselineTag: string;
  previousTag: string;
  componentsTag: string;
  gravityTag: string;
  displayTag: string;
}): { manifest: RollingReleaseManifest; sha256Sums: string } {
  const files = readdirSync(opts.distDir)
    .filter((f) => f !== 'RollingReleaseManifest.json' && f !== 'SHA256SUMS.txt')
    .sort();

  const components: BaselineComponentEntry[] = [];
  const sumLines: string[] = [];

  for (const filename of files) {
    const fullPath = join(opts.distDir, filename);
    const st = statSync(fullPath);
    if (!st.isFile() || st.size === 0) {
      throw new Error(`Invalid or empty baseline artifact: ${filename}`);
    }
    const sha256 = sha256File(fullPath);
    const meta = classifyArtifact(
      filename,
      { components: opts.componentsTag, gravity: opts.gravityTag, display: opts.displayTag },
      opts.baselineTag
    );
    components.push({
      filename,
      role: meta.role,
      source_repo: meta.source_repo,
      source_tag: meta.source_tag,
      bytes: st.size,
      sha256,
      download_url: `https://github.com/awesome-os/sectium-browser/releases/download/${opts.baselineTag}/${filename}`,
    });
    sumLines.push(`${sha256}  ${filename}`);
  }

  const requiredRoles: BaselineComponentEntry['role'][] = ['substrate', 'runtime', 'display', 'shim', 'shell', 'brand'];
  const presentRoles = new Set(components.map((c) => c.role));
  for (const role of requiredRoles) {
    if (!presentRoles.has(role)) {
      throw new Error(`Baseline manifest incomplete: missing required component role "${role}"`);
    }
  }

  const manifest: RollingReleaseManifest = {
    schema: 'sectium-baseline-v1',
    baseline_tag: opts.baselineTag,
    previous_tag: opts.previousTag,
    generated_at: new Date().toISOString(),
    brand: {
      product_name: 'Sectium Browser',
      mascot: 'Lumi White Dragon',
      replaces_chromium_appearance: true,
      icon_file: 'lumi-white-dragon.ico',
      brand_pack: 'lumi-white-dragon-brand-pack.tar.gz',
      overlay_file: 'chromium-brand-overlay.json',
    },
    chromium_baseline: {
      milestone: '146.x',
      v8_version: '16.0.88',
      is_component_build: true,
      build_with_tflite_lib: false,
    },
    abi: {
      control_plane: 'B8G_ABI_MAGIC_V3',
      display: 'B8G_DISPLAY_V1',
      arena: 'B8G_ARENA_V1',
    },
    components,
    downstream_contract: {
      v8_shared_pack: 'v8-shared-win64.b8p',
      display_abi_lib: 'libsectium_display.dll',
      native_shim: 'b8g-shim.exe',
      runtime_binary: 'bun-neon-v8.exe',
      ghost_registry: {
        schema: 'b8g-ghost-registry-v1',
        cas_layout: 'v11/files/<sha512[:2]>/<sha512>',
        ghost_release_repo: 'awesome-os/holo-v11',
        shards_manifest: 'ghost-shards-manifest.json',
        unified_index: 'ghost-index.json',
        max_version_lock: 'https://github.com/awesome-os/t2linux-baseline/blob/main/catalog/max-version-lock.json',
      },
    },
  };

  return { manifest, sha256Sums: sumLines.join('\n') + '\n' };
}

/**
 * Merges RollingReleaseManifest + all cross-repo Ghost sub-manifests (shards, holo-4os/5os, toolchains)
 * into a single flat O(1) resolver index (`ghost-index.json`) so clients only ever fetch 1 URL.
 */
export function buildUnifiedGhostIndex(
  distDir: string,
  manifest: RollingReleaseManifest
): UnifiedGhostIndex {
  const entries: Record<string, GhostIndexEntry> = {};

  for (const c of manifest.components) {
    entries[c.filename] = {
      filename: c.filename,
      sha256: c.sha256,
      cas_key: c.sha256.slice(0, 16),
      category: 'baseline',
      source_manifest: 'RollingReleaseManifest.json',
      download_url: c.download_url,
    };
  }

  const subManifests: Array<{ file: string; category: GhostIndexEntry['category']; arrayKey: string }> = [
    { file: 'ghost-shards-manifest.json', category: 'shard', arrayKey: 'shards' },
    { file: 'ghost-4os-manifest.json', category: 'holo-5os', arrayKey: 'libs' },
    { file: 'ghost-5os-manifest.json', category: 'holo-5os', arrayKey: 'libs' },
    { file: 'ghost-toolchains-manifest.json', category: 'toolchain', arrayKey: 'toolchains' },
  ];

  for (const sub of subManifests) {
    const full = join(distDir, sub.file);
    if (!existsSync(full)) continue;
    const parsed = JSON.parse(readFileSync(full, 'utf8')) as Record<string, unknown>;
    const list = (parsed[sub.arrayKey] ?? parsed['libs'] ?? parsed['entries'] ?? []) as Array<
      Record<string, unknown>
    >;
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const filename = String(item['filename'] ?? item['file'] ?? '');
      const sha256 = String(item['sha256'] ?? '').toLowerCase();
      const downloadUrl = String(item['download_url'] ?? item['url'] ?? '');
      if (!filename || !sha256 || !downloadUrl) continue;
      entries[filename] = {
        filename,
        sha256,
        cas_key: sha256.slice(0, 16),
        category: sub.category,
        source_manifest: sub.file,
        download_url: downloadUrl,
      };
    }
  }

  const sortedEntries: Record<string, GhostIndexEntry> = {};
  for (const k of Object.keys(entries).sort()) {
    sortedEntries[k] = entries[k]!;
  }

  return {
    schema: 'b8g-ghost-unified-index-v1',
    baseline_tag: manifest.baseline_tag,
    generated_at: manifest.generated_at,
    cas_layout: '<cas>/<sha256>/<filename>',
    total_entries: Object.keys(sortedEntries).length,
    entries: sortedEntries,
  };
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('baseline-manifest.mts')) {
  const distDir = process.argv[2] ?? 'dist-baseline';
  const baselineTag = process.env.BASELINE_TAG ?? 'v0.7.0-baseline';
  const previousTag = process.env.PREVIOUS_TAG ?? 'v0.6.1-baseline';
  const componentsTag = process.env.COMPONENTS_TAG ?? 'v0.4.0-components';
  const gravityTag = process.env.GRAVITY_TAG ?? 'v0.5.0-gravity';
  const displayTag = process.env.DISPLAY_TAG ?? 'v0.4.0';

  const { manifest, sha256Sums } = buildRollingReleaseManifest({
    distDir,
    baselineTag,
    previousTag,
    componentsTag,
    gravityTag,
    displayTag,
  });

  const unifiedIndex = buildUnifiedGhostIndex(distDir, manifest);
  writeFileSync(join(distDir, 'RollingReleaseManifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(join(distDir, 'ghost-index.json'), JSON.stringify(unifiedIndex, null, 2) + '\n');
  writeFileSync(join(distDir, 'SHA256SUMS.txt'), sha256Sums);
  console.log(
    `[sectium-baseline] Assembled ${manifest.baseline_tag}: ${manifest.components.length} baseline components | ${unifiedIndex.total_entries} unified ghost-index entries (previous=${manifest.previous_tag})`
  );
}
