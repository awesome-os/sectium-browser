import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALL_COMPONENT_BUCKETS,
  adaptMaxTusOnOverrun,
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

test('computeUpstreamGravityPlan reports 0 bounces when baseline matches upstream', () => {
  const plan = computeUpstreamGravityPlan({
    upstream: BASE_UPSTREAM,
    currentMilestone: '146.x',
    currentV8: '16.0.88',
  });
  assert.equal(plan.needsRebuild, false);
  assert.equal(plan.dirtyBuckets.length, 0);
  assert.equal(plan.totalBounces, 0);
});

test('computeUpstreamGravityPlan splits V8 patch into 4 fast micro-shards (3 v8-shared + 1 sectium-shell)', () => {
  const plan = computeUpstreamGravityPlan({
    upstream: { ...BASE_UPSTREAM, v8Version: '16.0.92' },
    currentMilestone: '146.x',
    currentV8: '16.0.88',
    maxTusPerDrop: 600,
  });
  assert.equal(plan.needsRebuild, true);
  assert.deepEqual(plan.dirtyBuckets, ['v8-shared', 'sectium-shell']);
  assert.equal(plan.totalBounces, 4);
  assert.equal(plan.microShards[0]?.shardId, 'v8-shared#01/03');
  assert.equal(plan.microShards[3]?.shardId, 'sectium-shell#01/01');
});

test('computeUpstreamGravityPlan splits full milestone bump into 30 fast micro-bounces at 600 TUs/drop', () => {
  const plan = computeUpstreamGravityPlan({
    upstream: { ...BASE_UPSTREAM, chromiumVersion: '159.0.8154.13', milestone: 159, v8Version: '4593f4dc1e9b' },
    currentMilestone: '146.x',
    currentV8: '16.0.88',
    maxTusPerDrop: 600,
  });
  assert.equal(plan.needsRebuild, true);
  assert.equal(plan.dirtyBuckets.length, ALL_COMPONENT_BUCKETS.length);
  assert.equal(plan.totalBounces, 30);
  assert.equal(plan.brandOverlay, 'brand/lumi-white-dragon/chromium-brand-overlay.json');
});

test('adaptMaxTusOnOverrun shrinks drop size automatically when a runner runs slower than budget', () => {
  assert.equal(adaptMaxTusOnOverrun(600, 300, 480), 600);
  assert.equal(adaptMaxTusOnOverrun(600, 960, 480), 300);
  assert.equal(adaptMaxTusOnOverrun(150, 1200, 300), 100);
});
