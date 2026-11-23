/**
 * @file upstream/chromium-tracker.mts
 * @description Queries Chromium Dash Stable channel to detect upstream Chromium & V8 updates,
 * compares against the active Sectium Browser RollingReleaseManifest, and computes an
 * **Adaptive Damped Gravity** micro-shard drop plan that splits heavy Chromium subsystems
 * into fast, bounded drops (`maxTusPerDrop`) and auto-splits further if a drop exceeds budget.
 *
 * Strictly zero external dependencies, `erasableSyntaxOnly: true`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export interface UpstreamReleaseInfo {
  readonly channel: 'Stable';
  readonly platform: string;
  readonly chromiumVersion: string;
  readonly milestone: number;
  readonly v8Version: string;
  readonly commitSha: string;
  readonly fetchedAt: string;
}

export interface ComponentBucketSpec {
  readonly name: string;
  readonly estimatedTus: number;
  readonly ninjaTarget: string;
}

export interface GravityMicroShard {
  readonly shardId: string;
  readonly bucket: string;
  readonly ninjaTarget: string;
  readonly shardIndex: number;
  readonly shardTotal: number;
  readonly estimatedTus: number;
}

export interface GravityDropPlan {
  readonly schema: 'sectium-upstream-gravity-plan-v2';
  readonly upstream: UpstreamReleaseInfo;
  readonly currentBaselineMilestone: string;
  readonly currentBaselineV8: string;
  readonly needsRebuild: boolean;
  readonly reason: string;
  readonly maxTusPerDrop: number;
  readonly dampingFactor: number;
  readonly dirtyBuckets: readonly string[];
  readonly microShards: readonly GravityMicroShard[];
  readonly totalBounces: number;
  readonly brandOverlay: 'brand/lumi-white-dragon/chromium-brand-overlay.json';
}

export const CHROMIUM_COMPONENT_SPECS: readonly ComponentBucketSpec[] = [
  { name: 'base-core', estimatedTus: 900, ninjaTarget: 'base' },
  { name: 'v8-shared', estimatedTus: 1800, ninjaTarget: 'v8:v8_libbase v8:v8' },
  { name: 'skia-gfx', estimatedTus: 1400, ninjaTarget: 'skia' },
  { name: 'net-stack', estimatedTus: 1600, ninjaTarget: 'net' },
  { name: 'content-runtime', estimatedTus: 4200, ninjaTarget: 'content/public/browser' },
  { name: 'blink-core', estimatedTus: 6400, ninjaTarget: 'third_party/blink/renderer/core' },
  { name: 'sectium-shell', estimatedTus: 400, ninjaTarget: 'chrome' },
] as const;

export const ALL_COMPONENT_BUCKETS = CHROMIUM_COMPONENT_SPECS.map((s) => s.name);

export async function fetchLatestChromiumStable(platform = 'Windows'): Promise<UpstreamReleaseInfo> {
  const url = `https://chromiumdash.appspot.com/fetch_releases?channel=Stable&platform=${encodeURIComponent(platform)}&num=1`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Chromium Dash API HTTP ${res.status} for ${url}`);
  }
  const rows = (await res.json()) as Array<{
    version?: string;
    milestone?: number;
    hashes?: { v8?: string; chromium?: string };
    v8_version?: string;
  }>;
  const latest = rows[0];
  if (!latest?.version) {
    throw new Error('Chromium Dash API returned empty release list');
  }
  return {
    channel: 'Stable',
    platform,
    chromiumVersion: latest.version,
    milestone: latest.milestone ?? Number.parseInt(latest.version.split('.')[0] ?? '0', 10),
    v8Version: latest.v8_version ?? latest.hashes?.v8?.slice(0, 12) ?? 'unknown',
    commitSha: latest.hashes?.chromium ?? 'unknown',
    fetchedAt: new Date().toISOString(),
  };
}

export function expandBucketsToMicroShards(
  bucketNames: readonly string[],
  maxTusPerDrop = 600
): GravityMicroShard[] {
  const cap = Math.max(50, Math.floor(maxTusPerDrop));
  const shards: GravityMicroShard[] = [];
  for (const name of bucketNames) {
    const spec = CHROMIUM_COMPONENT_SPECS.find((s) => s.name === name);
    if (!spec) continue;
    const count = Math.max(1, Math.ceil(spec.estimatedTus / cap));
    for (let i = 0; i < count; i++) {
      const remaining = spec.estimatedTus - i * cap;
      const tus = Math.min(cap, remaining);
      const pad = String(i + 1).padStart(2, '0');
      shards.push({
        shardId: `${spec.name}#${pad}/${String(count).padStart(2, '0')}`,
        bucket: spec.name,
        ninjaTarget: spec.ninjaTarget,
        shardIndex: i + 1,
        shardTotal: count,
        estimatedTus: tus,
      });
    }
  }
  return shards;
}

/**
 * Adaptive damping: if a drop took longer than targetDropSeconds, shrink maxTusPerDrop
 * proportionally (clamped to >= 100 TUs) so subsequent bounces finish faster and never time out.
 */
export function adaptMaxTusOnOverrun(
  currentMaxTus: number,
  observedSeconds: number,
  targetDropSeconds: number
): number {
  if (observedSeconds <= targetDropSeconds || targetDropSeconds <= 0) {
    return currentMaxTus;
  }
  const ratio = targetDropSeconds / observedSeconds;
  return Math.max(100, Math.floor(currentMaxTus * Math.min(0.75, ratio)));
}

export function computeUpstreamGravityPlan(opts: {
  upstream: UpstreamReleaseInfo;
  currentMilestone: string;
  currentV8: string;
  forceRebuild?: boolean;
  maxTusPerDrop?: number;
}): GravityDropPlan {
  const maxTusPerDrop = opts.maxTusPerDrop ?? 600;
  const curMajor = Number.parseInt(opts.currentMilestone.replace(/[^0-9].*$/, ''), 10) || 0;
  const milestoneChanged = opts.upstream.milestone > curMajor;
  const v8Changed = opts.upstream.v8Version !== opts.currentV8;
  const needsRebuild = Boolean(opts.forceRebuild || milestoneChanged || v8Changed);

  let dirtyBuckets: string[] = [];
  let reason = 'Up to date with upstream Chromium Stable';

  if (opts.forceRebuild) {
    dirtyBuckets = [...ALL_COMPONENT_BUCKETS];
    reason = 'Forced full component rebuild requested';
  } else if (milestoneChanged) {
    dirtyBuckets = [...ALL_COMPONENT_BUCKETS];
    reason = `New Chromium milestone ${opts.upstream.chromiumVersion} (was ${opts.currentMilestone})`;
  } else if (v8Changed) {
    dirtyBuckets = ['v8-shared', 'sectium-shell'];
    reason = `New upstream V8 ${opts.upstream.v8Version} (was ${opts.currentV8})`;
  }

  const microShards = expandBucketsToMicroShards(dirtyBuckets, maxTusPerDrop);

  return {
    schema: 'sectium-upstream-gravity-plan-v2',
    upstream: opts.upstream,
    currentBaselineMilestone: opts.currentMilestone,
    currentBaselineV8: opts.currentV8,
    needsRebuild,
    reason,
    maxTusPerDrop,
    dampingFactor: 0.65,
    dirtyBuckets,
    microShards,
    totalBounces: microShards.length,
    brandOverlay: 'brand/lumi-white-dragon/chromium-brand-overlay.json',
  };
}

if (process.argv[1]?.endsWith('chromium-tracker.mts')) {
  const manifestPath = process.argv[2] ?? '';
  const outPath = process.argv[3] ?? 'upstream-gravity-plan.json';
  const force = process.env['FORCE_REBUILD'] === 'true';
  const maxTus = Number.parseInt(process.env['MAX_TUS_PER_DROP'] ?? '600', 10) || 600;

  let currentMilestone = '146.x';
  let currentV8 = '16.0.88';
  if (manifestPath && existsSync(manifestPath)) {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      chromium_baseline?: { milestone?: string; v8_version?: string };
    };
    currentMilestone = m.chromium_baseline?.milestone ?? currentMilestone;
    currentV8 = m.chromium_baseline?.v8_version ?? currentV8;
  }

  const upstream = await fetchLatestChromiumStable('Windows');
  const plan = computeUpstreamGravityPlan({
    upstream,
    currentMilestone,
    currentV8,
    forceRebuild: force,
    maxTusPerDrop: maxTus,
  });

  writeFileSync(outPath, JSON.stringify(plan, null, 2) + '\n');
  console.log(
    `[upstream-tracker] Upstream Chromium=${upstream.chromiumVersion} (V8=${upstream.v8Version}) | needsRebuild=${plan.needsRebuild} | dirtyBuckets=${plan.dirtyBuckets.length} | microShards=${plan.totalBounces} (maxTusPerDrop=${plan.maxTusPerDrop}) | reason=${plan.reason}`
  );
}
