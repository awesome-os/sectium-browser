import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
      cas_layout: '<cas>/<sha256>/<filename>';
      ghost_release_repo: 'awesome-os/b8g-ghost';
      shards_manifest: 'ghost-shards-manifest.json';
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
        cas_layout: '<cas>/<sha256>/<filename>',
        ghost_release_repo: 'awesome-os/b8g-ghost',
        shards_manifest: 'ghost-shards-manifest.json',
      },
    },
  };

  return { manifest, sha256Sums: sumLines.join('\n') + '\n' };
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('baseline-manifest.mts')) {
  const distDir = process.argv[2] ?? 'dist-baseline';
  const baselineTag = process.env.BASELINE_TAG ?? 'v0.5.0-baseline';
  const previousTag = process.env.PREVIOUS_TAG ?? 'v0.4.0-components';
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

  writeFileSync(join(distDir, 'RollingReleaseManifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(join(distDir, 'SHA256SUMS.txt'), sha256Sums);
  console.log(
    `[sectium-baseline] Assembled ${manifest.baseline_tag}: ${manifest.components.length} verified components (previous=${manifest.previous_tag})`
  );
}
