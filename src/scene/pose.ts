// Pose channels, motion clips and body-part classification. Pure math: unit-testable without WebGL.
import type { Part } from '../game/engine';

export interface Pose {
  yaw: number; // head
  pitch: number;
  roll: number;
  breath: number;
  cheek: number;
  jaw: number;
  pawL: number;
  pawR: number;
  earL: number;
  earR: number;
  stretch: number;
  poke: number;
  hop: number; // root
  spin: number;
  lean: number;
  squash: number;
}

export const ZERO: Pose = {
  yaw: 0, pitch: 0, roll: 0, breath: 0, cheek: 0, jaw: 0, pawL: 0, pawR: 0, earL: 0, earR: 0,
  stretch: 0, poke: 0, hop: 0, spin: 0, lean: 0, squash: 0,
};

export type ClipFn = (t: number, dur: number) => Partial<Pose>;
export interface ClipDef {
  dur: number;
  priority: number; // 1 idle, 2 touch, 3 expression/care, 4 eating
  fn: ClipFn;
}

const s = Math.sin;
const PI = Math.PI;
const env = (t: number, d: number, a = 0.25) => Math.min(1, t / a, (d - t) / a); // fade in/out
const bump = (x: number) => (x <= 0 || x >= 1 ? 0 : s(x * PI));
const hops = (t: number, n: number, d: number, h: number) => {
  const p = (t / d) * n;
  return p >= n ? 0 : bump(p % 1) * h;
};

export const EXPRESSIONS = [
  'wheelSprint', 'seedToss', 'happyHop', 'spinDance', 'shyCheeks', 'curiousSniff',
  'proudPose', 'sleepyNod', 'surpriseJump', 'wiggle', 'bow', 'starGaze',
] as const;
export type ExpressionId = (typeof EXPRESSIONS)[number];

export const CLIPS: Record<string, ClipDef> = {
  // ---- 12 expressive sequences -------------------------------------------------------------
  wheelSprint: { dur: 2.6, priority: 3, fn: (t, d) => { const e = env(t, d); return { pawL: e * (0.5 + 0.5 * s(t * 22)), pawR: e * (0.5 - 0.5 * s(t * 22)), lean: e * 0.22, pitch: e * 0.15, hop: e * Math.abs(s(t * 22)) * 0.025, earL: -e * 0.6, earR: -e * 0.6 }; } },
  seedToss: { dur: 2.4, priority: 3, fn: (t, d) => { const up = t < 1.1 ? t / 1.1 : Math.max(0, 1 - (t - 1.1) * 3); return { pawL: up, pawR: up, pitch: -0.35 * env(t, d, 0.5), hop: t > 1.1 ? hops(t - 1.1, 1, 0.6, 0.12) : 0, cheek: 0.3 * env(t, d) }; } },
  happyHop: { dur: 2.0, priority: 3, fn: (t, d) => ({ hop: hops(t, 3, d, 0.14), squash: -Math.cos((t / d) * 6 * PI) * 0.06 * env(t, d), earL: 0.5, earR: 0.5, pawL: 0.4 * env(t, d), pawR: 0.4 * env(t, d) }) },
  spinDance: { dur: 3.0, priority: 3, fn: (t, d) => { const e = env(t, d, 0.4); return { spin: (t / d) * 2 * PI, roll: s(t * 8) * 0.18 * e, pawL: e * (0.6 + 0.4 * s(t * 8)), pawR: e * (0.6 - 0.4 * s(t * 8)), hop: Math.abs(s(t * 8)) * 0.04 * e }; } },
  shyCheeks: { dur: 2.4, priority: 3, fn: (t, d) => { const e = env(t, d, 0.4); return { cheek: e, roll: 0.22 * e, yaw: -0.35 * e, pawL: 0.7 * e, pawR: 0.7 * e, pitch: 0.15 * e }; } },
  curiousSniff: { dur: 2.4, priority: 3, fn: (t, d) => { const e = env(t, d, 0.4); return { pitch: 0.28 * e, lean: 0.12 * e, yaw: s(t * 3) * 0.35 * e, jaw: Math.max(0, s(t * 30)) * 0.25 * e, earL: 0.6 * e, earR: 0.6 * e }; } },
  proudPose: { dur: 2.6, priority: 3, fn: (t, d) => { const e = env(t, d, 0.5); return { stretch: 0.6 * e, pitch: -0.3 * e, pawL: 0.35 * e, pawR: 0.35 * e, cheek: 0.3 * e, earL: 0.4 * e, earR: 0.4 * e }; } },
  sleepyNod: { dur: 3.2, priority: 3, fn: (t, d) => { const nod = t < 2.2 ? (t / 2.2) * 0.55 : Math.max(0, 0.55 - (t - 2.2) * 2.5); return { pitch: nod * env(t, d, 0.3), stretch: -0.25 * env(t, d), earL: -0.7 * env(t, d), earR: -0.7 * env(t, d), jaw: t > 2.2 && t < 2.8 ? 0.6 : 0 }; } },
  surpriseJump: { dur: 1.6, priority: 3, fn: (t, d) => ({ hop: hops(t, 1, 0.8, 0.3), stretch: t < 0.8 ? 0.5 * bump(t / 0.8) : 0, squash: t > 0.8 && t < 1.1 ? 0.15 * bump((t - 0.8) / 0.3) : 0, earL: env(t, d), earR: env(t, d), pawL: 0.9 * env(t, d, 0.15), pawR: 0.9 * env(t, d, 0.15), pitch: -0.2 * env(t, d) }) },
  wiggle: { dur: 2.0, priority: 3, fn: (t, d) => { const e = env(t, d); return { roll: s(t * 14) * 0.2 * e, spin: s(t * 7) * 0.25 * e, squash: s(t * 14) * 0.04 * e }; } },
  bow: { dur: 2.6, priority: 3, fn: (t, d) => { const e = env(t, d, 0.8); return { pitch: 0.55 * e, lean: 0.18 * e, pawL: 0.3 * e, pawR: 0.3 * e }; } },
  starGaze: { dur: 3.6, priority: 3, fn: (t, d) => { const e = env(t, d, 0.8); return { pitch: -0.5 * e, yaw: s(t * 0.9) * 0.3 * e, pawL: 0.45 * e, stretch: 0.25 * e, earL: 0.3 * e, earR: 0.3 * e }; } },
  // ---- invitations (held until answered or timed out) --------------------------------------
  highFive: { dur: 6, priority: 3, fn: (t, d) => { const e = env(t, d, 0.4); return { pawR: e * 1.2, roll: -0.12 * e, cheek: 0.2 * e, yaw: 0.1 * e }; } },
  nuzzle: { dur: 6, priority: 3, fn: (t, d) => { const e = env(t, d, 0.5); return { pitch: 0.3 * e, lean: 0.2 * e, roll: s(t * 2) * 0.1 * e, earL: -0.5 * e, earR: -0.5 * e }; } },
  // ---- care ---------------------------------------------------------------------------------
  cuddle: { dur: 2.4, priority: 3, fn: (t, d) => { const e = env(t, d, 0.5); return { lean: 0.15 * e, squash: 0.06 * e, cheek: 0.6 * e, pawL: 0.5 * e, pawR: 0.5 * e, roll: s(t * 3) * 0.1 * e }; } },
  brush: { dur: 2.6, priority: 3, fn: (t, d) => { const e = env(t, d); return { roll: s(t * 6) * 0.12 * e, pitch: -0.15 * e, earL: -0.4 * e, earR: -0.4 * e, stretch: 0.2 * e }; } },
  ball: { dur: 2.6, priority: 3, fn: (t, d) => ({ ...CLIPS.happyHop.fn(t, d), pawL: t > 0.6 && t < 1.2 ? 1 : 0.2, yaw: s(t * 4) * 0.2 }) },
  // ---- eating -------------------------------------------------------------------------------
  eat: { dur: 3.4, priority: 4, fn: (t, d) => { const e = env(t, d, 0.3); return { jaw: e * Math.abs(s(t * 17)), cheek: Math.min(1, t / 1.5) * e, pawL: 0.85 * e + s(t * 17) * 0.05, pawR: 0.85 * e - s(t * 17) * 0.05, pitch: 0.12 * e }; } },
  // ---- touch reactions (distinct per part) -------------------------------------------------
  t_head: { dur: 1.4, priority: 2, fn: (t, d) => { const e = env(t, d, 0.3); return { pitch: -0.18 * e, earL: -0.8 * e, earR: -0.8 * e, squash: 0.03 * e }; } },
  t_cheek: { dur: 1.4, priority: 2, fn: (t, d) => { const e = env(t, d, 0.3); return { cheek: e, roll: 0.18 * e, yaw: -0.2 * e }; } },
  t_nose: { dur: 1.2, priority: 2, fn: (t, d) => { const e = env(t, d, 0.2); return { pitch: -0.1 * e, jaw: Math.max(0, s(t * 26)) * 0.4 * e, stretch: t < 0.3 ? -0.15 : 0, lean: -0.1 * e }; } },
  t_belly: { dur: 1.4, priority: 2, fn: (t, d) => { const e = env(t, d, 0.2); return { roll: s(t * 18) * 0.12 * e, squash: 0.06 * e, pawL: 0.6 * e, pawR: 0.6 * e, cheek: 0.3 * e }; } },
  t_paw: { dur: 1.4, priority: 2, fn: (t, d) => { const e = env(t, d, 0.2); return { pawR: e * (0.8 + 0.2 * s(t * 16)), yaw: 0.15 * e }; } },
  t_feet: { dur: 1.2, priority: 2, fn: (t) => ({ hop: hops(t, 2, 0.9, 0.06), earL: 0.5, earR: 0.5 }) },
  t_back: { dur: 1.6, priority: 2, fn: (t, d) => { const e = env(t, d, 0.4); return { stretch: 0.3 * e, pitch: -0.22 * e, earL: -0.6 * e, earR: -0.6 * e }; } },
  // ---- idle (varied with energy) -----------------------------------------------------------
  i_look: { dur: 3.2, priority: 1, fn: (t, d) => { const e = env(t, d, 0.7); return { yaw: s(t * 1.9) * 0.45 * e, pitch: -0.05 * e }; } },
  i_groom: { dur: 3.4, priority: 1, fn: (t, d) => { const e = env(t, d, 0.6); return { pawL: 0.9 * e, pawR: 0.9 * e, pitch: 0.18 * e + s(t * 9) * 0.05 * e, roll: s(t * 4.5) * 0.08 * e }; } },
  i_stretch: { dur: 2.8, priority: 1, fn: (t, d) => { const e = env(t, d, 0.9); return { stretch: 0.55 * e, pitch: -0.25 * e, pawL: 0.5 * e, pawR: 0.5 * e, jaw: t > 1 && t < 1.8 ? 0.7 * e : 0 }; } },
  i_attention: { dur: 2.0, priority: 1, fn: (t, d) => { const e = env(t, d, 0.3); return { earL: 0.8 * e, earR: 0.8 * e, pitch: -0.1 * e, yaw: 0.25 * e }; } },
  i_yawn: { dur: 2.6, priority: 1, fn: (t, d) => { const e = env(t, d, 0.6); return { jaw: e, pitch: -0.2 * e, stretch: 0.15 * e, earL: -0.4 * e, earR: -0.4 * e }; } },
};

/** Idle choice depends on energy: tired Pip yawns and nods, energetic Pip looks around and stretches. */
export function pickIdle(energy: number, r: number): string {
  if (energy < 25) return r < 0.5 ? 'i_yawn' : r < 0.8 ? 'i_groom' : 'i_look';
  if (energy < 60) return r < 0.35 ? 'i_look' : r < 0.65 ? 'i_groom' : r < 0.85 ? 'i_attention' : 'i_stretch';
  return r < 0.35 ? 'i_look' : r < 0.55 ? 'i_attention' : r < 0.8 ? 'i_stretch' : 'i_groom';
}
export const idleGapSeconds = (energy: number, r: number) => (energy < 30 ? 7 : 4) + r * 5;

export function touchClip(part: Part, gesture: string): string {
  if (gesture === 'tripleTap') return 'surpriseJump';
  if (part === 'cheek' && gesture === 'stroke') return 'shyCheeks';
  if (part === 'head' && gesture === 'hold') return 'nuzzle';
  return `t_${part}`;
}

/** Exponential approach: frame-rate independent smoothing between poses. */
export function approach(cur: Pose, target: Pose, dt: number, rate = 9): Pose {
  const k = 1 - Math.exp(-rate * dt);
  const out = { ...cur };
  for (const key of Object.keys(target) as (keyof Pose)[]) {
    if (key === 'spin') out.spin = target.spin; // spins are explicit angles; smoothing them would unwind
    else out[key] = cur[key] + (target[key] - cur[key]) * k;
  }
  return out;
}

export function addPose(a: Pose, b: Partial<Pose>, w = 1): Pose {
  const out = { ...a };
  for (const [k, v] of Object.entries(b) as [keyof Pose, number][]) out[k] += v * w;
  return out;
}

// ---- body landmarks and part classification -------------------------------------------------

export interface Landmarks {
  min: [number, number, number];
  size: [number, number, number];
  nose: [number, number, number]; // normalised 0..1 per axis
  neck: number; // normalised height where the head begins
}

/** Finds the nose tip (front-most centre vertex in the head band) from the authored mesh. */
export function findLandmarks(pos: ArrayLike<number>, count: number, get: (i: number, c: number) => number): Landmarks {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++)
    for (let c = 0; c < 3; c++) {
      const v = get(i, c);
      if (v < min[c]) min[c] = v;
      if (v > max[c]) max[c] = v;
    }
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  let best = -Infinity;
  let nose: [number, number, number] = [0.5, 0.7, 1];
  for (let i = 0; i < count; i++) {
    const x = (get(i, 0) - min[0]) / size[0];
    const y = (get(i, 1) - min[1]) / size[1];
    const z = (get(i, 2) - min[2]) / size[2];
    if (Math.abs(x - 0.5) < 0.05 && y > 0.4 && y < 0.92 && z > best) {
      best = z;
      nose = [x, y, z];
    }
  }
  void pos;
  return { min: min as Landmarks['min'], size: size as Landmarks['size'], nose, neck: Math.max(0.35, nose[1] - 0.16) };
}

/** Classifies a hit point given in normalised mesh coordinates (0..1 per axis, +z is the face). */
export function classify(u: [number, number, number], lm: Landmarks): Part {
  const [x, y, z] = u;
  const dx = x - 0.5;
  const [, ny, nz] = lm.nose;
  if (y < 0.1) return 'feet';
  if (Math.hypot(dx, y - ny, (z - nz) * 0.6) < 0.075) return 'nose';
  if (y >= lm.neck) {
    if (z > 0.45 && Math.abs(dx) > 0.12 && Math.abs(dx) < 0.45 && y < ny + 0.04 && y > ny - 0.16) return 'cheek';
    return 'head';
  }
  if (z < 0.45) return 'back';
  if (Math.abs(dx) > 0.2 && y > 0.18) return 'paw';
  return 'belly';
}

export const mouthOf = (lm: Landmarks): [number, number, number] => [0.5, lm.nose[1] - 0.06, lm.nose[2] - 0.04];
