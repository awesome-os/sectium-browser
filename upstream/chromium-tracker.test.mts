import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALL_COMPONENT_BUCKETS,
  computeUpstreamGravityPlan,
  type UpstreamReleaseInfo,
} from './chromium-tracker.mts';

const BASE_UPSTREAM: UpstreamReleaseInfo = {
  channel: 'Stable',
  platform: 'Windows',
  chromiumVersion: '146.0.7680.100',
  milestone: 146,
  v8Version: '16.0.88',
  commitSha: 'abcdef123456',
  fetchedAt: '2026-11-23T09:00:00.000Z',
};

test('computeUpstreamGravityPlan reports 0 dirty buckets when baseline matches upstream', () => {
  const plan = computeUpstreamGravityPlan({
    upstream: BASE_UPSTREAM,
    currentMilestone: '146.x',
    currentV8: '16.0.88',
  });
  assert.equal(plan.needsRebuild, false);
  assert.equal(plan.dirtyBuckets.length, 0);
  assert.equal(plan.totalBounces, 0);
});

test('computeUpstreamGravityPlan schedules only v8-shared + sectium-shell on V8 security patch', () => {
  const plan = computeUpstreamGravityPlan({
    upstream: { ...BASE_UPSTREAM, v8Version: '16.0.92' },
    currentMilestone: '146.x',
    currentV8: '16.0.88',
  });
  assert.equal(plan.needsRebuild, true);
  assert.deepEqual(plan.dirtyBuckets, ['v8-shared', 'sectium-shell']);
  assert.equal(plan.totalBounces, 2);
});

test('computeUpstreamGravityPlan schedules all 7 component buckets on new Chromium milestone', () => {
  const plan = computeUpstreamGravityPlan({
    upstream: { ...BASE_UPSTREAM, chromiumVersion: '147.0.7700.10', milestone: 147, v8Version: '16.1.10' },
    currentMilestone: '146.x',
    currentV8: '16.0.88',
  });
  assert.equal(plan.needsRebuild, true);
  assert.equal(plan.dirtyBuckets.length, ALL_COMPONENT_BUCKETS.length);
  assert.equal(plan.brandOverlay, 'brand/lumi-white-dragon/chromium-brand-overlay.json');
});
