'use strict';

const CHROME_HEIGHT = 44;
const SIDEBAR_COLLAPSED_WIDTH = 52;
const SIDEBAR_EXPANDED_WIDTH = 248;
const SPLIT_DIVIDER_WIDTH = 6;

const GROUP_COLORS = [
  '#38bdf8', // sky
  '#a78bfa', // violet
  '#34d399', // emerald
  '#fbbf24', // amber
  '#fb7185', // rose
  '#60a5fa', // blue
];

function clampSplitRatio(ratio) {
  const n = Number(ratio);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(0.8, Math.max(0.2, n));
}

function getSidebarWidth(expanded) {
  return expanded ? SIDEBAR_EXPANDED_WIDTH : SIDEBAR_COLLAPSED_WIDTH;
}

/**
 * Computes exact pixel bounds for single-pane or side-by-side split WebContentsViews,
 * plus the draggable divider rectangle when split mode is active.
 */
function computeViewportBounds({ contentWidth, contentHeight, sidebarExpanded, splitActive, splitRatio = 0.5 }) {
  const sidebarW = getSidebarWidth(Boolean(sidebarExpanded));
  const availW = Math.max(1, Math.floor(contentWidth) - sidebarW);
  const availH = Math.max(1, Math.floor(contentHeight) - CHROME_HEIGHT);

  if (!splitActive) {
    return {
      sidebarWidth: sidebarW,
      primary: { x: sidebarW, y: CHROME_HEIGHT, width: availW, height: availH },
      secondary: null,
      divider: null,
    };
  }

  const ratio = clampSplitRatio(splitRatio);
  const usableW = Math.max(2, availW - SPLIT_DIVIDER_WIDTH);
  const leftW = Math.max(1, Math.floor(usableW * ratio));
  const rightW = Math.max(1, usableW - leftW);
  const dividerX = sidebarW + leftW;

  return {
    sidebarWidth: sidebarW,
    primary: { x: sidebarW, y: CHROME_HEIGHT, width: leftW, height: availH },
    secondary: { x: dividerX + SPLIT_DIVIDER_WIDTH, y: CHROME_HEIGHT, width: rightW, height: availH },
    divider: { x: dividerX, y: CHROME_HEIGHT, width: SPLIT_DIVIDER_WIDTH, height: availH },
  };
}

/**
 * Filters tabs for Tab-Suche (matches title, url, or group title case-insensitively).
 */
function filterTabsByQuery(tabs, groups, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return tabs;
  const groupNameById = new Map();
  for (const g of groups || []) {
    groupNameById.set(g.id, String(g.title || '').toLowerCase());
  }
  return tabs.filter((t) => {
    const title = String(t.title || '').toLowerCase();
    const url = String(t.url || '').toLowerCase();
    const gName = t.groupId != null ? (groupNameById.get(t.groupId) || '') : '';
    return title.includes(q) || url.includes(q) || gName.includes(q);
  });
}

module.exports = {
  CHROME_HEIGHT,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_EXPANDED_WIDTH,
  SPLIT_DIVIDER_WIDTH,
  GROUP_COLORS,
  clampSplitRatio,
  getSidebarWidth,
  computeViewportBounds,
  filterTabsByQuery,
};
