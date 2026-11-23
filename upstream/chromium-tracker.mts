/**
 * @file upstream/chromium-tracker.mts
 * @description Queries Chromium Dash Stable channel to detect upstream Chromium & V8 updates,
 * compares against the active Sectium Browser RollingReleaseManifest, and computes the
 * Damped Gravity Scheduler component bucket drop plan.
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

export interface GravityDropPlan {
  readonly schema: 'sectium-upstream-gravity-plan-v1';
  readonly upstream: UpstreamReleaseInfo;
  readonly currentBaselineMilestone: string;
  readonly currentBaselineV8: string;
  readonly needsRebuild: boolean;
  readonly reason: string;
  readonly dirtyBuckets: readonly string[];
  readonly totalBounces: number;
  readonly brandOverlay: 'brand/lumi-white-dragon/chromium-brand-overlay.json';
}

export const ALL_COMPONENT_BUCKETS = [
  'v8-shared',
  'base-core',
  'net-stack',
  'skia-gfx',
  'blink-core',
  'content-runtime',
  'sectium-shell',
] as const;

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

export function computeUpstreamGravityPlan(opts: {
  upstream: UpstreamReleaseInfo;
  currentMilestone: string;
  currentV8: string;
  forceRebuild?: boolean;
}): GravityDropPlan {
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

  return {
    schema: 'sectium-upstream-gravity-plan-v1',
    upstream: opts.upstream,
    currentBaselineMilestone: opts.currentMilestone,
    currentBaselineV8: opts.currentV8,
    needsRebuild,
    reason,
    dirtyBuckets,
    totalBounces: dirtyBuckets.length,
    brandOverlay: 'brand/lumi-white-dragon/chromium-brand-overlay.json',
  };
}

if (process.argv[1]?.endsWith('chromium-tracker.mts')) {
  const manifestPath = process.argv[2] ?? '';
  const outPath = process.argv[3] ?? 'upstream-gravity-plan.json';
  const force = process.env['FORCE_REBUILD'] === 'true';

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
  });

  writeFileSync(outPath, JSON.stringify(plan, null, 2) + '\n');
  console.log(
    `[upstream-tracker] Upstream Chromium=${upstream.chromiumVersion} (V8=${upstream.v8Version}) | needsRebuild=${plan.needsRebuild} | dirtyBuckets=${plan.dirtyBuckets.length} | reason=${plan.reason}`
  );
}
