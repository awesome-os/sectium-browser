/**
 * @file sections/sectium-device/virtual-frame-shell.mts
 * @description Minimal Virtual-Frame Browser Shell Engine (`sectium-shell`) replacing
 * Chromium's bloated `//chrome` shell.
 *
 * Combines three core UX & systems primitives in one zero-dependency engine:
 *   1. Collapsible Vertical Tab Sidebar + Tab Groups (`Tabgruppen`) + search + audio/signal badges
 *   2. Horizontal Multi-Pane Split View (2+ mixed `web` / `vscode` / `terminal` / `devtools` frames
 *      side-by-side with draggable split ratios for effortless copy-paste & mixed-content workflows)
 *   3. Signal-Driven Memory Freeze/Thaw Scheduler (`ACTIVE -> IDLE -> FROZEN -> CHECKPOINTED`)
 *      that never freezes focused, split-visible, or signal-emitting (e.g., audio/stream) frames,
 *      and thaws cold frames live with zero reload and zero lost DOM/editor state.
 *
 * Strictly `erasableSyntaxOnly: true` & zero external dependencies.
 */

export type VirtualFrameKind = 'web' | 'vscode' | 'terminal' | 'devtools';
export type VirtualFrameLifecycle = 'ACTIVE' | 'IDLE' | 'FROZEN' | 'CHECKPOINTED';
export type FrameSignalKind = 'audio' | 'stream' | 'ipc' | 'media' | 'download';

export interface TabGroup {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly collapsed: boolean;
}

export interface VirtualFrame {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly kind: VirtualFrameKind;
  readonly groupId: string | null;
  readonly lifecycle: VirtualFrameLifecycle;
  readonly activeSignals: readonly FrameSignalKind[];
  readonly lastActivityMs: number;
  readonly estimatedRamMb: number;
  readonly checkpointEpoch: number;
}

export interface PaneRect {
  readonly frameId: string;
  readonly kind: VirtualFrameKind;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ShellLayoutRects {
  readonly sidebarRect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly panes: readonly PaneRect[];
  readonly dividers: readonly { readonly index: number; readonly x: number; readonly y: number; readonly width: number; readonly height: number }[];
}

export interface LifecycleThresholds {
  readonly idleAfterMs?: number;
  readonly freezeAfterMs?: number;
  readonly checkpointAfterMs?: number;
}

export interface ShellStats {
  readonly totalFrames: number;
  readonly activeCount: number;
  readonly idleCount: number;
  readonly frozenCount: number;
  readonly checkpointedCount: number;
  readonly activeRamMb: number;
  readonly savedRamMb: number;
}

interface MutableFrame {
  id: string;
  title: string;
  url: string;
  kind: VirtualFrameKind;
  groupId: string | null;
  lifecycle: VirtualFrameLifecycle;
  activeSignals: Set<FrameSignalKind>;
  lastActivityMs: number;
  baseRamMb: number;
  checkpointEpoch: number;
}

const DIVIDER_PX = 6;
const SIDEBAR_OPEN_PX = 248;
const SIDEBAR_COLLAPSED_PX = 48;

export class SectiumVirtualFrameShell {
  readonly #frames = new Map<string, MutableFrame>();
  readonly #groups = new Map<string, TabGroup>();
  #splitFrameIds: string[] = [];
  #splitRatios: number[] = [];
  #focusedFrameId: string | null = null;
  #sidebarCollapsed = false;
  #epochCounter = 0;

  readonly #idleAfterMs: number;
  readonly #freezeAfterMs: number;
  readonly #checkpointAfterMs: number;

  constructor(thresholds: LifecycleThresholds = {}) {
    this.#idleAfterMs = thresholds.idleAfterMs ?? 30_000;
    this.#freezeAfterMs = thresholds.freezeAfterMs ?? 120_000;
    this.#checkpointAfterMs = thresholds.checkpointAfterMs ?? 300_000;
  }

  createTabGroup(id: string, label: string, color = '#38bdf8'): TabGroup {
    const grp: TabGroup = { id, label, color, collapsed: false };
    this.#groups.set(id, grp);
    return grp;
  }

  listTabGroups(): TabGroup[] {
    return Array.from(this.#groups.values());
  }

  toggleSidebar(): boolean {
    this.#sidebarCollapsed = !this.#sidebarCollapsed;
    return this.#sidebarCollapsed;
  }

  isSidebarCollapsed(): boolean {
    return this.#sidebarCollapsed;
  }

  createFrame(opts: {
    readonly id: string;
    readonly title: string;
    readonly url: string;
    readonly kind?: VirtualFrameKind;
    readonly groupId?: string | null;
    readonly baseRamMb?: number;
    readonly nowMs?: number;
  }): VirtualFrame {
    const now = opts.nowMs ?? Date.now();
    const frame: MutableFrame = {
      id: opts.id,
      title: opts.title,
      url: opts.url,
      kind: opts.kind ?? 'web',
      groupId: opts.groupId ?? null,
      lifecycle: 'ACTIVE',
      activeSignals: new Set(),
      lastActivityMs: now,
      baseRamMb: opts.baseRamMb ?? 120,
      checkpointEpoch: 0,
    };
    this.#frames.set(frame.id, frame);
    if (this.#splitFrameIds.length === 0) {
      this.#splitFrameIds = [frame.id];
      this.#splitRatios = [1];
      this.#focusedFrameId = frame.id;
    }
    return this.#toPublic(frame);
  }

  focusFrame(frameId: string, nowMs = Date.now()): VirtualFrame {
    const f = this.#frames.get(frameId);
    if (!f) throw new Error(`Unknown VirtualFrame: ${frameId}`);
    this.#focusedFrameId = frameId;
    if (!this.#splitFrameIds.includes(frameId)) {
      this.#splitFrameIds = [frameId];
      this.#splitRatios = [1];
    }
    this.#thaw(f, nowMs);
    return this.#toPublic(f);
  }

  /**
   * Lays out 1, 2, 3, or N Virtual Frames horizontally side-by-side (e.g. Twitch + Docs,
   * or Web + VS Code + Terminal) and immediately thaws every visible pane.
   */
  setSplitView(frameIds: readonly string[], ratios?: readonly number[], nowMs = Date.now()): readonly VirtualFrame[] {
    if (frameIds.length === 0) {
      throw new Error('Split view requires at least 1 VirtualFrame');
    }
    const unique: string[] = [];
    for (const id of frameIds) {
      if (!this.#frames.has(id)) throw new Error(`Unknown VirtualFrame in split: ${id}`);
      if (!unique.includes(id)) unique.push(id);
    }

    this.#splitFrameIds = unique;
    if (ratios && ratios.length === unique.length) {
      const sum = ratios.reduce((a, b) => a + b, 0);
      this.#splitRatios = sum > 0 ? ratios.map((r) => r / sum) : unique.map(() => 1 / unique.length);
    } else {
      this.#splitRatios = unique.map(() => 1 / unique.length);
    }

    if (!this.#focusedFrameId || !unique.includes(this.#focusedFrameId)) {
      this.#focusedFrameId = unique[0];
    }

    const out: VirtualFrame[] = [];
    for (const id of unique) {
      const f = this.#frames.get(id)!;
      this.#thaw(f, nowMs);
      out.push(this.#toPublic(f));
    }
    return out;
  }

  /**
   * Drags the horizontal split divider between pane `dividerIndex` and `dividerIndex + 1`,
   * preserving total width and clamping each pane to >= 15% of their combined span.
   */
  resizeSplit(dividerIndex: number, leftFractionOfPair: number): readonly number[] {
    if (dividerIndex < 0 || dividerIndex >= this.#splitRatios.length - 1) {
      throw new RangeError(`Invalid split divider index: ${dividerIndex}`);
    }
    const clamped = Math.max(0.15, Math.min(0.85, leftFractionOfPair));
    const pairSum = this.#splitRatios[dividerIndex] + this.#splitRatios[dividerIndex + 1];
    this.#splitRatios[dividerIndex] = Number((pairSum * clamped).toFixed(4));
    this.#splitRatios[dividerIndex + 1] = Number((pairSum * (1 - clamped)).toFixed(4));
    return [...this.#splitRatios];
  }

  setFrameSignal(frameId: string, signal: FrameSignalKind, active: boolean, nowMs = Date.now()): VirtualFrame {
    const f = this.#frames.get(frameId);
    if (!f) throw new Error(`Unknown VirtualFrame: ${frameId}`);
    if (active) {
      f.activeSignals.add(signal);
      this.#thaw(f, nowMs);
    } else {
      f.activeSignals.delete(signal);
      f.lastActivityMs = nowMs;
    }
    return this.#toPublic(f);
  }

  /**
   * Advances the Signal-Driven Memory Freeze Scheduler.
   * Frames that are focused, visible in the active horizontal split, or carrying any active
   * signal (e.g. `audio`, `stream`, `ipc`) stay ACTIVE. All others freeze cleanly without killing state.
   */
  tickLifecycle(nowMs: number): ShellStats {
    const visibleSet = new Set(this.#splitFrameIds);
    for (const f of this.#frames.values()) {
      const keepAlive =
        f.id === this.#focusedFrameId || visibleSet.has(f.id) || f.activeSignals.size > 0;
      if (keepAlive) {
        if (f.lifecycle !== 'ACTIVE') {
          this.#thaw(f, nowMs);
        }
        continue;
      }

      const elapsed = Math.max(0, nowMs - f.lastActivityMs);
      if (elapsed >= this.#checkpointAfterMs) {
        if (f.lifecycle !== 'CHECKPOINTED') {
          this.#epochCounter += 1;
          f.checkpointEpoch = this.#epochCounter;
          f.lifecycle = 'CHECKPOINTED';
        }
      } else if (elapsed >= this.#freezeAfterMs) {
        f.lifecycle = 'FROZEN';
      } else if (elapsed >= this.#idleAfterMs) {
        f.lifecycle = 'IDLE';
      }
    }
    return this.getStats();
  }

  computeLayoutRects(totalWidth: number, totalHeight: number): ShellLayoutRects {
    const sbWidth = this.#sidebarCollapsed ? SIDEBAR_COLLAPSED_PX : SIDEBAR_OPEN_PX;
    const sidebarRect = { x: 0, y: 0, width: sbWidth, height: totalHeight };

    const count = this.#splitFrameIds.length;
    const dividersCount = Math.max(0, count - 1);
    const availW = Math.max(100, totalWidth - sbWidth - dividersCount * DIVIDER_PX);

    const panes: PaneRect[] = [];
    const dividers: { index: number; x: number; y: number; width: number; height: number }[] = [];
    let cursorX = sbWidth;

    for (let i = 0; i < count; i++) {
      const id = this.#splitFrameIds[i];
      const f = this.#frames.get(id)!;
      const w = i === count - 1 ? Math.max(1, totalWidth - cursorX) : Math.max(1, Math.round(availW * this.#splitRatios[i]));
      panes.push({ frameId: id, kind: f.kind, x: cursorX, y: 0, width: w, height: totalHeight });
      cursorX += w;
      if (i < count - 1) {
        dividers.push({ index: i, x: cursorX, y: 0, width: DIVIDER_PX, height: totalHeight });
        cursorX += DIVIDER_PX;
      }
    }

    return { sidebarRect, panes, dividers };
  }

  searchFrames(query: string): VirtualFrame[] {
    const q = query.trim().toLowerCase();
    const all = Array.from(this.#frames.values()).map((f) => this.#toPublic(f));
    if (!q) return all;
    return all.filter((f) => f.title.toLowerCase().includes(q) || f.url.toLowerCase().includes(q));
  }

  getFrame(frameId: string): VirtualFrame | null {
    const f = this.#frames.get(frameId);
    return f ? this.#toPublic(f) : null;
  }

  getStats(): ShellStats {
    let activeCount = 0;
    let idleCount = 0;
    let frozenCount = 0;
    let checkpointedCount = 0;
    let activeRamMb = 0;
    let savedRamMb = 0;

    for (const f of this.#frames.values()) {
      const curRam = this.#effectiveRamMb(f);
      activeRamMb += curRam;
      savedRamMb += Math.max(0, f.baseRamMb - curRam);
      if (f.lifecycle === 'ACTIVE') activeCount++;
      else if (f.lifecycle === 'IDLE') idleCount++;
      else if (f.lifecycle === 'FROZEN') frozenCount++;
      else checkpointedCount++;
    }

    return {
      totalFrames: this.#frames.size,
      activeCount,
      idleCount,
      frozenCount,
      checkpointedCount,
      activeRamMb: Number(activeRamMb.toFixed(1)),
      savedRamMb: Number(savedRamMb.toFixed(1)),
    };
  }

  renderB8gShellElement(): string {
    const splitAttr = this.#splitFrameIds.join(',');
    const stats = this.getStats();
    return `<b8g-sectium-shell data-sidebar-collapsed="${this.#sidebarCollapsed}" data-split-frames="${splitAttr}" data-active="${stats.activeCount}" data-frozen="${stats.frozenCount}" data-checkpointed="${stats.checkpointedCount}" data-saved-ram-mb="${stats.savedRamMb}"></b8g-sectium-shell>`;
  }

  #thaw(f: MutableFrame, nowMs: number): void {
    f.lifecycle = 'ACTIVE';
    f.lastActivityMs = nowMs;
  }

  #effectiveRamMb(f: MutableFrame): number {
    if (f.lifecycle === 'ACTIVE') return f.baseRamMb;
    if (f.lifecycle === 'IDLE') return f.baseRamMb * 0.75;
    if (f.lifecycle === 'FROZEN') return f.baseRamMb * 0.25;
    // CHECKPOINTED: only RGBA preview slab remains in RAM (~4 MB)
    return Math.min(f.baseRamMb, 4);
  }

  #toPublic(f: MutableFrame): VirtualFrame {
    return {
      id: f.id,
      title: f.title,
      url: f.url,
      kind: f.kind,
      groupId: f.groupId,
      lifecycle: f.lifecycle,
      activeSignals: Array.from(f.activeSignals).sort(),
      lastActivityMs: f.lastActivityMs,
      estimatedRamMb: Number(this.#effectiveRamMb(f).toFixed(1)),
      checkpointEpoch: f.checkpointEpoch,
    };
  }
}
