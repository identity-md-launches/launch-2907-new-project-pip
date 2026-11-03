import { describe, expect, it } from 'vitest';
import { GestureTracker, HOLD_MS } from '../src/scene/gestures';

function make(onPip = (x: number) => x < 100, mode: 'pet' | 'turn' = 'pet') {
  const out: string[] = [];
  let turned = 0;
  const g = new GestureTracker(
    (x) => (onPip(x) ? { part: 'feet' as const, point: null } : null),
    (e) => out.push(`${e.part}:${e.gesture}`),
    (dx) => (turned += dx),
    () => mode,
  );
  return { g, out, turned: () => turned };
}

describe('GestureTracker', () => {
  it('tap, then three quick taps make the surprise', () => {
    const { g, out } = make();
    for (const t of [0, 200, 400]) {
      g.pointerDown(10, 10, t);
      g.pointerUp(10, 10, t + 50);
    }
    expect(out).toEqual(['feet:tap', 'feet:tap', 'feet:tripleTap']);
  });
  it('stroke across Pip', () => {
    const { g, out } = make();
    g.pointerDown(10, 10, 0);
    for (let x = 12; x <= 60; x += 4) g.pointerMove(x, 10, x * 5);
    g.pointerUp(60, 10, 400);
    expect(out).toEqual(['feet:stroke']);
  });
  it('hold fires once', () => {
    const { g, out } = make();
    g.pointerDown(10, 10, 0);
    g.tick(HOLD_MS + 1);
    g.tick(HOLD_MS + 100);
    g.pointerUp(10, 10, HOLD_MS + 200);
    expect(out).toEqual(['feet:hold']);
  });
  it('background clicks, cancelled drags and drags off Pip award nothing', () => {
    const { g, out } = make();
    g.pointerDown(300, 10, 0);
    g.pointerUp(300, 10, 50);
    g.pointerDown(10, 10, 0);
    g.pointerMove(50, 10, 100);
    g.cancel();
    g.pointerUp(50, 10, 200);
    g.pointerDown(10, 10, 0);
    for (let x = 100; x < 400; x += 20) g.pointerMove(x, 10, x);
    g.pointerUp(400, 10, 500);
    expect(out).toEqual([]);
  });
  it('turn mode only turns', () => {
    const { g, out, turned } = make(() => true, 'turn');
    g.pointerDown(10, 10, 0);
    g.pointerMove(60, 10, 100);
    g.pointerUp(60, 10, 120);
    expect(out).toEqual([]);
    expect(turned()).toBe(50);
  });
});
