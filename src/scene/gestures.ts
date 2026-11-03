import type { Gesture, Part } from '../game/engine';

export interface Hit<P = unknown> {
  part: Part;
  point: P;
}
export interface GestureEvent<P = unknown> {
  part: Part;
  gesture: Gesture;
  point?: P;
}

export const TAP_MAX_MS = 350;
export const TAP_MAX_MOVE = 8;
export const HOLD_MS = 650;
export const STROKE_MIN_MOVE = 28;
export const TRIPLE_WINDOW_MS = 900;

/**
 * Turns raw pointer samples into pet gestures. DOM-free so it can be tested directly.
 * - Background (no hit at pointerdown) never produces a gesture.
 * - pointercancel, or a drag that mostly left Pip, produces nothing.
 * - Turn mode never produces a pet gesture; it only reports horizontal drag.
 */
export class GestureTracker<P = unknown> {
  private down: { x: number; y: number; t: number; hit: Hit<P>; moved: number; onPip: number; samples: number; held: boolean; lx: number } | null = null;
  private taps: number[] = [];
  private turning: { lx: number } | null = null;

  constructor(
    private hit: (x: number, y: number) => Hit<P> | null,
    private emit: (e: GestureEvent<P>) => void,
    private turn: (dx: number) => void,
    private mode: () => 'pet' | 'turn',
  ) {}

  pointerDown(x: number, y: number, t: number) {
    if (this.mode() === 'turn') {
      this.turning = { lx: x };
      return;
    }
    const h = this.hit(x, y);
    this.down = h ? { x, y, t, hit: h, moved: 0, onPip: 1, samples: 1, held: false, lx: x } : null;
  }

  pointerMove(x: number, y: number, t: number) {
    if (this.turning) {
      this.turn(x - this.turning.lx);
      this.turning.lx = x;
      return;
    }
    const d = this.down;
    if (!d) return;
    d.moved = Math.max(d.moved, Math.hypot(x - d.x, y - d.y));
    d.samples++;
    if (this.hit(x, y)) d.onPip++;
    this.tick(t);
  }

  /** Called on move and by a timer: fires `hold` once when the pointer rests on Pip long enough. */
  tick(t: number) {
    const d = this.down;
    if (d && !d.held && d.moved < TAP_MAX_MOVE && t - d.t >= HOLD_MS) {
      d.held = true;
      this.emit({ part: d.hit.part, gesture: 'hold', point: d.hit.point });
    }
  }

  pointerUp(_x: number, _y: number, t: number) {
    this.turning = null;
    const d = this.down;
    this.down = null;
    if (!d || d.held) return;
    if (d.moved < TAP_MAX_MOVE && t - d.t <= TAP_MAX_MS) {
      this.taps = [...this.taps.filter((x) => t - x < TRIPLE_WINDOW_MS), t];
      if (this.taps.length >= 3) {
        this.taps = [];
        this.emit({ part: d.hit.part, gesture: 'tripleTap', point: d.hit.point });
      } else this.emit({ part: d.hit.part, gesture: 'tap', point: d.hit.point });
      return;
    }
    if (d.moved >= STROKE_MIN_MOVE && d.onPip / d.samples >= 0.6) {
      this.emit({ part: d.hit.part, gesture: 'stroke', point: d.hit.point });
    }
    // Anything else (slow press-and-release, drag off Pip) is ignored: no award.
  }

  cancel() {
    this.down = null;
    this.turning = null;
  }
}

export class PointerGestures {
  private tracker: GestureTracker;
  private timer = 0;
  private active: number | null = null;
  private off: () => void;

  constructor(
    el: HTMLElement,
    h: {
      hit: (x: number, y: number) => Hit | null;
      turn: (dx: number) => void;
      gesture: (e: GestureEvent) => void;
      mode: () => 'pet' | 'turn';
    },
  ) {
    this.tracker = new GestureTracker(h.hit, h.gesture, h.turn, h.mode);
    const down = (e: PointerEvent) => {
      if (this.active !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
      this.active = e.pointerId;
      el.setPointerCapture?.(e.pointerId);
      this.tracker.pointerDown(e.clientX, e.clientY, performance.now());
      this.timer = window.setInterval(() => this.tracker.tick(performance.now()), 50);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId === this.active) this.tracker.pointerMove(e.clientX, e.clientY, performance.now());
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== this.active) return;
      this.active = null;
      clearInterval(this.timer);
      this.tracker.pointerUp(e.clientX, e.clientY, performance.now());
    };
    const cancel = (e: PointerEvent) => {
      if (e.pointerId !== this.active) return;
      this.active = null;
      clearInterval(this.timer);
      this.tracker.cancel();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('lostpointercapture', cancel);
    this.off = () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      el.removeEventListener('lostpointercapture', cancel);
    };
  }
  dispose() {
    clearInterval(this.timer);
    this.off();
  }
}
