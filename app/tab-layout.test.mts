import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const {
  CHROME_HEIGHT,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_EXPANDED_WIDTH,
  SPLIT_DIVIDER_WIDTH,
  clampSplitRatio,
  computeViewportBounds,
  filterTabsByQuery,
} = require('./tab-layout.js');

describe('Sectium Browser vertical sidebar, split tabs & tab groups layout', () => {
  it('computes single-pane bounds for collapsed and expanded sidebar', () => {
    const collapsed = computeViewportBounds({
      contentWidth: 1360,
      contentHeight: 860,
      sidebarExpanded: false,
      splitActive: false,
    });
    assert.equal(collapsed.sidebarWidth, SIDEBAR_COLLAPSED_WIDTH);
    assert.deepEqual(collapsed.primary, {
      x: SIDEBAR_COLLAPSED_WIDTH,
      y: CHROME_HEIGHT,
      width: 1360 - SIDEBAR_COLLAPSED_WIDTH,
      height: 860 - CHROME_HEIGHT,
    });
    assert.equal(collapsed.secondary, null);
    assert.equal(collapsed.divider, null);

    const expanded = computeViewportBounds({
      contentWidth: 1360,
      contentHeight: 860,
      sidebarExpanded: true,
      splitActive: false,
    });
    assert.equal(expanded.sidebarWidth, SIDEBAR_EXPANDED_WIDTH);
    assert.equal(expanded.primary.x, SIDEBAR_EXPANDED_WIDTH);
    assert.equal(expanded.primary.width, 1360 - SIDEBAR_EXPANDED_WIDTH);
  });

  it('computes side-by-side split pane bounds with draggable divider and clamped ratio', () => {
    const split = computeViewportBounds({
      contentWidth: 1360,
      contentHeight: 860,
      sidebarExpanded: false,
      splitActive: true,
      splitRatio: 0.5,
    });
    assert.ok(split.secondary);
    assert.ok(split.divider);
    assert.equal(split.divider.width, SPLIT_DIVIDER_WIDTH);
    assert.equal(
      split.primary.width + split.divider.width + split.secondary.width,
      1360 - SIDEBAR_COLLAPSED_WIDTH,
    );
    assert.equal(split.divider.x, split.primary.x + split.primary.width);
    assert.equal(split.secondary.x, split.divider.x + split.divider.width);

    assert.equal(clampSplitRatio(0.05), 0.2);
    assert.equal(clampSplitRatio(0.95), 0.8);
    assert.equal(clampSplitRatio(Number.NaN), 0.5);
  });

  it('filters tabs by title, url, and tab group name', () => {
    const groups = [
      { id: 1, title: 'Research', color: '#38bdf8', collapsed: false },
      { id: 2, title: 'Video', color: '#fb7185', collapsed: false },
    ];
    const tabs = [
      { id: 1, title: 'Frank Lemanschik (@AI___Frank)', url: 'https://x.com/AI___Frank', groupId: 1 },
      { id: 2, title: 'YouTube Premium', url: 'https://youtube.com/watch?v=123', groupId: 2 },
      { id: 3, title: 'awesome-os/lo', url: 'https://github.com/awesome-os/lo', groupId: 1 },
    ];

    assert.deepEqual(filterTabsByQuery(tabs, groups, 'research').map((t) => t.id), [1, 3]);
    assert.deepEqual(filterTabsByQuery(tabs, groups, 'youtube').map((t) => t.id), [2]);
    assert.deepEqual(filterTabsByQuery(tabs, groups, 'github.com').map((t) => t.id), [3]);
    assert.equal(filterTabsByQuery(tabs, groups, '').length, 3);
  });
});
