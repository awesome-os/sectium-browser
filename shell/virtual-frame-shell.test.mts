import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SectiumVirtualFrameShell } from './virtual-frame-shell.mts';

describe('SectiumVirtualFrameShell (Vertical Sidebar + Horizontal Mixed Split + Signal Freeze)', () => {
  it('1. supports vertical tab groups, sidebar collapse, search, and mixed web + vscode + terminal horizontal split', () => {
    const shell = new SectiumVirtualFrameShell();
    shell.createTabGroup('work', 'Tabgruppen', '#38bdf8');
    shell.createFrame({ id: 'twitch', title: 'PANZA069 - Twitch', url: 'https://twitch.tv/panza069', kind: 'web', groupId: 'work', nowMs: 1000 });
    shell.createFrame({ id: 'docs', title: 'duix.com/pricing', url: 'https://duix.com/pricing', kind: 'web', groupId: 'work', nowMs: 1000 });
    shell.createFrame({ id: 'ide', title: 'VS Code Workbench', url: 'sectium://vscode', kind: 'vscode', groupId: 'work', nowMs: 1000 });

    const split = shell.setSplitView(['twitch', 'docs', 'ide'], [0.3, 0.35, 0.35], 1000);
    assert.equal(split.length, 3);
    assert.deepEqual(split.map((f) => f.kind), ['web', 'web', 'vscode']);

    const rects = shell.computeLayoutRects(1440, 900);
    assert.equal(rects.sidebarRect.width, 248);
    assert.equal(rects.panes.length, 3);
    assert.equal(rects.dividers.length, 2);
    assert.equal(rects.panes[0].x, 248);

    // Drag divider 0 and collapse sidebar
    const ratios = shell.resizeSplit(0, 0.6);
    assert.ok(ratios[0] > ratios[1]);
    assert.equal(shell.toggleSidebar(), true);
    assert.equal(shell.computeLayoutRects(1440, 900).sidebarRect.width, 48);
    assert.equal(shell.searchFrames('twitch').length, 1);
  });

  it('2. freezes & checkpoints silent background tabs while keeping split-visible & audio-emitting tabs ACTIVE', () => {
    const shell = new SectiumVirtualFrameShell({
      idleAfterMs: 10_000,
      freezeAfterMs: 30_000,
      checkpointAfterMs: 60_000,
    });
    const t0 = 1_000_000;
    shell.createFrame({ id: 'pane-left', title: 'Docs', url: 'https://awesome-os.com', baseRamMb: 120, nowMs: t0 });
    shell.createFrame({ id: 'pane-right', title: 'VS Code', url: 'sectium://vscode', kind: 'vscode', baseRamMb: 160, nowMs: t0 });
    shell.createFrame({ id: 'bg-audio', title: 'PANZA069 - Twitch', url: 'https://twitch.tv/panza069', baseRamMb: 140, nowMs: t0 });
    shell.createFrame({ id: 'bg-silent', title: 'Old Research Tab', url: 'https://example.org', baseRamMb: 100, nowMs: t0 });

    // Split left + right visible; bg-audio emits live audio signal; bg-silent has no focus & no signals
    shell.setSplitView(['pane-left', 'pane-right'], [0.5, 0.5], t0);
    shell.setFrameSignal('bg-audio', 'audio', true, t0);

    // After 35s: bg-silent -> FROZEN; visible panes & bg-audio stay ACTIVE
    shell.tickLifecycle(t0 + 35_000);
    assert.equal(shell.getFrame('pane-left')?.lifecycle, 'ACTIVE');
    assert.equal(shell.getFrame('pane-right')?.lifecycle, 'ACTIVE');
    assert.equal(shell.getFrame('bg-audio')?.lifecycle, 'ACTIVE');
    assert.equal(shell.getFrame('bg-silent')?.lifecycle, 'FROZEN');

    // After 70s: bg-silent -> CHECKPOINTED (.b8p epoch assigned, RAM drops 100 MB -> 4 MB)
    const stats = shell.tickLifecycle(t0 + 70_000);
    assert.equal(shell.getFrame('bg-silent')?.lifecycle, 'CHECKPOINTED');
    assert.equal(shell.getFrame('bg-silent')?.checkpointEpoch, 1);
    assert.equal(shell.getFrame('bg-silent')?.estimatedRamMb, 4);
    assert.equal(stats.savedRamMb, 96);

    // Focusing bg-silent thaws it live back to ACTIVE with zero reload!
    const thawed = shell.focusFrame('bg-silent', t0 + 71_000);
    assert.equal(thawed.lifecycle, 'ACTIVE');
    assert.equal(thawed.estimatedRamMb, 100);
  });

  it('3. emits declarative HTML5 <b8g-sectium-shell data-*> element', () => {
    const shell = new SectiumVirtualFrameShell();
    shell.createFrame({ id: 'a', title: 'A', url: 'https://a.test', nowMs: 1 });
    shell.createFrame({ id: 'b', title: 'B', url: 'sectium://vscode', kind: 'vscode', nowMs: 1 });
    shell.setSplitView(['a', 'b'], [0.5, 0.5], 1);
    const el = shell.renderB8gShellElement();
    assert.match(el, /^<b8g-sectium-shell /);
    assert.match(el, /data-split-frames="a,b"/);
  });
});
