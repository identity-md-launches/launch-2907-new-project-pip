// Pure game rules for Pip. No DOM, no storage: every function takes `now` and returns a new state.
// Growth follows elapsed real time only (never interaction counts), so click-spam cannot grow Pip.

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const MAX_AWAY_MS = 7 * DAY;

export type StageId = 'baby' | 'young' | 'junior' | 'grown' | 'star';
export const STAGES: readonly { id: StageId; at: number; model: string; accessory: AccessoryId | null }[] = [
  { id: 'baby', at: 0, model: 'models/01-tiny-bean.glb', accessory: null },
  { id: 'young', at: 1 * DAY, model: 'models/02-milk-mochi.glb', accessory: 'bow' },
  { id: 'junior', at: 3 * DAY, model: 'models/03-curious-baby.glb', accessory: 'scarf' },
  { id: 'grown', at: 7 * DAY, model: 'models/04-lively-youngster.glb', accessory: 'leaf' },
  { id: 'star', at: 21 * DAY, model: 'models/05-little-guardian.glb', accessory: 'star' },
];

export type AccessoryId = 'bow' | 'scarf' | 'leaf' | 'star';
export type FoodId = 'seed' | 'carrot' | 'berry';
export const FOODS: Record<FoodId, { fullness: number }> = {
  seed: { fullness: 18 },
  carrot: { fullness: 24 },
  berry: { fullness: 12 },
};
export type Part = 'head' | 'cheek' | 'nose' | 'belly' | 'paw' | 'feet' | 'back';
export type Gesture = 'tap' | 'stroke' | 'hold' | 'tripleTap';
export type CareAction = 'cuddle' | 'brush' | 'ball' | 'dance';
export type GameId = 'memory' | 'seeds';
export type WishId = 'feed' | 'brush' | 'ball' | 'dance' | 'cuddle' | 'pet-head' | 'pet-cheek' | 'memory' | 'seeds';

export const RULES = {
  dailyBondCap: 30,
  petRewardEveryMs: 20_000,
  feedCooldownMs: 45_000,
  fullAt: 90,
  fullnessDecayPerHour: 4,
  energyDecayPerHour: 3,
  energyRegenPerMinuteAsleep: 2,
  gameRewardEveryMs: 10 * MINUTE,
  care: {
    cuddle: { cooldown: 30_000, energy: -2, bond: 1, minEnergy: 0 },
    brush: { cooldown: 60_000, energy: 0, bond: 1, minEnergy: 0 },
    ball: { cooldown: 60_000, energy: -10, bond: 2, minEnergy: 20 },
    dance: { cooldown: 90_000, energy: -12, bond: 2, minEnergy: 25 },
  } as Record<CareAction, { cooldown: number; energy: number; bond: number; minEnergy: number }>,
} as const;

export interface Memory {
  id: string;
  at: number;
  kind: string;
}

export interface PipState {
  version: 1;
  createdAt: number;
  settledAt: number; // growth watermark
  growthMs: number;
  updatedAt: number;
  bond: number;
  energy: number;
  fullness: number;
  asleep: boolean;
  lastFedAt: number | null;
  lastPetRewardAt: number | null;
  lastGameRewardAt: number | null;
  cooldowns: Partial<Record<CareAction, number>>;
  day: string;
  bondToday: number;
  wishes: { id: WishId; done: boolean }[];
  memories: Memory[];
  accessory: AccessoryId | null;
  meals: number;
  importedFrom: string | null;
}

export type Reason =
  | 'asleep'
  | 'full'
  | 'cooldown'
  | 'tired'
  | 'awake'
  | 'rested'
  | 'locked'
  | 'busy'
  | 'unknown-food';

export interface Result {
  ok: boolean;
  state: PipState;
  reason?: Reason;
  bondGained: number;
  wishDone?: WishId;
  retryInMs?: number;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
export const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);

const WISH_POOL: WishId[] = ['feed', 'brush', 'ball', 'dance', 'cuddle', 'pet-head', 'pet-cheek', 'memory', 'seeds'];
export function wishesFor(day: string): { id: WishId; done: boolean }[] {
  // Deterministic per day: everybody gets three different wishes, no randomness to farm.
  let h = 2166136261;
  for (const c of day) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const pool = [...WISH_POOL];
  const out: { id: WishId; done: boolean }[] = [];
  for (let i = 0; i < 3; i++) {
    h = Math.imul(h ^ (h >>> 13), 2246822519) >>> 0;
    out.push({ id: pool.splice(h % pool.length, 1)[0], done: false });
  }
  return out;
}

export function createState(now: number): PipState {
  return {
    version: 1,
    createdAt: now,
    settledAt: now,
    growthMs: 0,
    updatedAt: now,
    bond: 10,
    energy: 80,
    fullness: 40,
    asleep: false,
    lastFedAt: null,
    lastPetRewardAt: null,
    lastGameRewardAt: null,
    cooldowns: {},
    day: dayKey(now),
    bondToday: 0,
    wishes: wishesFor(dayKey(now)),
    memories: [{ id: 'hello', at: now, kind: 'hello' }],
    accessory: null,
    meals: 0,
    importedFrom: null,
  };
}

/** Brings the state to `now`: growth (capped per absence), hunger, energy and the daily reset. */
export function advance(s: PipState, now: number): PipState {
  if (!Number.isFinite(now) || now <= s.updatedAt) return s; // a clock rollback never re-mints time
  const elapsed = Math.min(MAX_AWAY_MS, now - s.updatedAt);
  const hours = elapsed / HOUR;
  let energy = s.energy;
  if (s.asleep) energy = clamp(energy + (elapsed / MINUTE) * RULES.energyRegenPerMinuteAsleep);
  else energy = clamp(energy - hours * RULES.energyDecayPerHour);
  const prevStage = stageIndex(s.growthMs);
  let next: PipState = {
    ...s,
    growthMs: s.growthMs + elapsed,
    settledAt: now,
    updatedAt: now,
    fullness: clamp(s.fullness - hours * RULES.fullnessDecayPerHour),
    energy,
  };
  const day = dayKey(now);
  if (day !== s.day) next = { ...next, day, bondToday: 0, wishes: wishesFor(day) };
  const stage = stageIndex(next.growthMs);
  if (stage > prevStage) {
    next = remember(next, now, `stage-${STAGES[stage].id}`);
  }
  return next;
}

export const stageIndex = (growthMs: number) => {
  let i = 0;
  STAGES.forEach((st, k) => {
    if (growthMs >= st.at) i = k;
  });
  return i;
};
export const stageOf = (s: PipState) => STAGES[stageIndex(s.growthMs)];
export function nextStageIn(s: PipState): number | null {
  const i = stageIndex(s.growthMs);
  return i >= STAGES.length - 1 ? null : STAGES[i + 1].at - s.growthMs;
}
export const unlockedAccessories = (s: PipState): AccessoryId[] =>
  STAGES.slice(0, stageIndex(s.growthMs) + 1)
    .map((x) => x.accessory)
    .filter((x): x is AccessoryId => !!x);

function remember(s: PipState, now: number, kind: string): PipState {
  if (s.memories.some((m) => m.kind === kind)) return s;
  return { ...s, memories: [{ id: `${kind}-${now}`, at: now, kind }, ...s.memories].slice(0, 30) };
}

function gainBond(s: PipState, amount: number): { state: PipState; gained: number } {
  const gained = Math.max(0, Math.min(amount, RULES.dailyBondCap - s.bondToday, 100 - s.bond));
  return { state: { ...s, bond: s.bond + gained, bondToday: s.bondToday + gained }, gained };
}

function completeWish(s: PipState, id: WishId, now: number): { state: PipState; wish?: WishId; gained: number } {
  const w = s.wishes.find((x) => x.id === id && !x.done);
  if (!w) return { state: s, gained: 0 };
  let next: PipState = { ...s, wishes: s.wishes.map((x) => (x === w ? { ...x, done: true } : x)) };
  const g = gainBond(next, 3);
  next = g.state;
  if (next.wishes.every((x) => x.done)) next = remember(next, now, `wishes-${next.day}`);
  return { state: next, wish: id, gained: g.gained };
}

const fail = (s: PipState, reason: Reason, retryInMs?: number): Result => ({ ok: false, state: s, reason, bondGained: 0, retryInMs });

export function canFeed(s0: PipState, now: number): { ok: boolean; reason?: Reason; retryInMs?: number } {
  const s = advance(s0, now);
  if (s.asleep) return { ok: false, reason: 'asleep' };
  if (s.fullness >= RULES.fullAt) return { ok: false, reason: 'full' };
  if (s.lastFedAt !== null && now - s.lastFedAt < RULES.feedCooldownMs)
    return { ok: false, reason: 'cooldown', retryInMs: RULES.feedCooldownMs - (now - s.lastFedAt) };
  return { ok: true };
}

export function feed(s0: PipState, food: FoodId, now: number): Result {
  if (!Object.hasOwn(FOODS, food)) return fail(s0, 'unknown-food');
  const s = advance(s0, now);
  const check = canFeed(s, now);
  if (!check.ok) return fail(s0, check.reason!, check.retryInMs);
  let next: PipState = { ...s, fullness: clamp(s.fullness + FOODS[food].fullness), lastFedAt: now, meals: s.meals + 1 };
  const g = gainBond(next, 2);
  next = g.state;
  if (next.meals === 1) next = remember(next, now, 'first-meal');
  const w = completeWish(next, 'feed', now);
  return { ok: true, state: w.state, bondGained: g.gained + w.gained, wishDone: w.wish };
}

export function pet(s0: PipState, part: Part, gesture: Gesture, now: number): Result {
  const s = advance(s0, now);
  if (s.asleep) return fail(s0, 'asleep');
  let next = s;
  let gained = 0;
  // Touch always gets a reaction, but bond from touch is earned at most once per 20 s.
  if (s.lastPetRewardAt === null || now - s.lastPetRewardAt >= RULES.petRewardEveryMs) {
    const g = gainBond({ ...s, lastPetRewardAt: now }, 1);
    next = g.state;
    gained = g.gained;
  }
  if (gesture === 'tripleTap') next = remember(next, now, 'surprise');
  let wishDone: WishId | undefined;
  const wishId: WishId | null = part === 'head' ? 'pet-head' : part === 'cheek' ? 'pet-cheek' : null;
  if (wishId) {
    const w = completeWish(next, wishId, now);
    next = w.state;
    gained += w.gained;
    wishDone = w.wish;
  }
  return { ok: true, state: next, bondGained: gained, wishDone };
}

export function care(s0: PipState, action: CareAction, now: number): Result {
  const s = advance(s0, now);
  const rule = RULES.care[action];
  if (s.asleep) return fail(s0, 'asleep');
  const last = s.cooldowns[action];
  if (last !== undefined && now - last < rule.cooldown) return fail(s0, 'cooldown', rule.cooldown - (now - last));
  if (s.energy < rule.minEnergy) return fail(s0, 'tired');
  let next: PipState = { ...s, energy: clamp(s.energy + rule.energy), cooldowns: { ...s.cooldowns, [action]: now } };
  const g = gainBond(next, rule.bond);
  next = remember(g.state, now, `first-${action}`);
  const w = completeWish(next, action, now);
  return { ok: true, state: w.state, bondGained: g.gained + w.gained, wishDone: w.wish };
}

export function nap(s0: PipState, now: number): Result {
  const s = advance(s0, now);
  if (s.asleep) return fail(s0, 'asleep');
  if (s.energy >= 95) return fail(s0, 'rested');
  return { ok: true, state: remember({ ...s, asleep: true }, now, 'first-nap'), bondGained: 0 };
}

export function wake(s0: PipState, now: number): Result {
  const s = advance(s0, now);
  if (!s.asleep) return fail(s0, 'awake');
  return { ok: true, state: { ...s, asleep: false }, bondGained: 0 };
}

/** A finished mini-game. Practice rounds are always allowed; bond is paid at most every 10 minutes. */
export function finishGame(s0: PipState, game: GameId, won: boolean, now: number): Result {
  const s = advance(s0, now);
  if (s.asleep) return fail(s0, 'asleep');
  let next = s;
  let gained = 0;
  let wishDone: WishId | undefined;
  if (won && (s.lastGameRewardAt === null || now - s.lastGameRewardAt >= RULES.gameRewardEveryMs)) {
    const g = gainBond({ ...s, lastGameRewardAt: now }, 3);
    next = g.state;
    gained = g.gained;
  }
  if (won) {
    next = remember(next, now, `won-${game}`);
    const w = completeWish(next, game, now);
    next = w.state;
    gained += w.gained;
    wishDone = w.wish;
  }
  return { ok: true, state: next, bondGained: gained, wishDone };
}

export function equip(s0: PipState, accessory: AccessoryId | null, now: number): Result {
  const s = advance(s0, now);
  if (accessory && !unlockedAccessories(s).includes(accessory)) return fail(s0, 'locked');
  return { ok: true, state: { ...s, accessory }, bondGained: 0 };
}

// ---- validation and migration -------------------------------------------------------------

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isTime = (x: unknown) => x === null || isNum(x);

export function validate(x: unknown): PipState | null {
  const d = x as PipState;
  if (!d || typeof d !== 'object' || d.version !== 1) return null;
  for (const k of ['createdAt', 'settledAt', 'growthMs', 'updatedAt', 'bond', 'energy', 'fullness', 'bondToday', 'meals'] as const)
    if (!isNum(d[k]) || d[k] < 0) return null;
  if (d.bond > 100 || d.energy > 100 || d.fullness > 100) return null;
  if (typeof d.asleep !== 'boolean' || !isTime(d.lastFedAt) || !isTime(d.lastPetRewardAt) || !isTime(d.lastGameRewardAt)) return null;
  if (!Array.isArray(d.wishes) || !Array.isArray(d.memories) || typeof d.day !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.day) || d.bondToday > RULES.dailyBondCap) return null;
  if (d.updatedAt < d.createdAt || d.growthMs > 400 * DAY) return null;
  // Every element is checked so a damaged or edited backup can never be committed and later
  // crash rendering (e.g. wishes: [null]).
  if (d.wishes.length > WISH_POOL.length) return null;
  for (const w of d.wishes as unknown[]) {
    const x = w as { id?: unknown; done?: unknown };
    if (!x || typeof x !== 'object' || !WISH_POOL.includes(x.id as WishId) || typeof x.done !== 'boolean') return null;
  }
  if (new Set(d.wishes.map((w) => w.id)).size !== d.wishes.length) return null;
  if (d.memories.length > 30) return null;
  for (const m of d.memories as unknown[]) {
    const x = m as { id?: unknown; at?: unknown; kind?: unknown };
    if (!x || typeof x !== 'object' || typeof x.id !== 'string' || x.id.length > 80 || !isNum(x.at) || x.at < 0) return null;
    if (typeof x.kind !== 'string' || !MEMORY_KIND.test(x.kind)) return null;
  }
  if (d.accessory !== null && !['bow', 'scarf', 'leaf', 'star'].includes(d.accessory)) return null;
  if (!d.cooldowns || typeof d.cooldowns !== 'object' || Array.isArray(d.cooldowns)) return null;
  for (const [k, v] of Object.entries(d.cooldowns)) if (!(k in RULES.care) || !isNum(v) || v < 0) return null;
  if (d.importedFrom !== null && d.importedFrom !== undefined && typeof d.importedFrom !== 'string') return null;
  return d;
}

const MEMORY_KIND = /^(hello|imported|surprise|first-(meal|nap|cuddle|brush|ball|dance)|stage-(young|junior|grown|star)|won-(memory|seeds)|wishes-\d{4}-\d{2}-\d{2})$/;

export const LEGACY_KEY = 'squeek-public-pet-v1';
const LEGACY_STAGE_MS = [0, 1 * DAY, 3 * DAY, 7 * DAY, 21 * DAY];

/**
 * Converts the old site's save (`squeek-public-pet-v1`) into a new state. The old record is only read,
 * never written or removed. Old growth (`xp`, growth minutes, version-2 clock) is preserved; an old
 * pre-clock save keeps its stage by the old XP thresholds.
 */
export function migrateLegacy(raw: string, now: number): PipState | null {
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!d || d.version !== 1 || !Number.isSafeInteger(d.xp) || (d.xp as number) < 0) return null;
  if (!isNum(d.fullness) || (d.fullness as number) < 0 || (d.fullness as number) > 100) return null;
  let growthMs: number;
  const g = d.growth as { version?: number } | undefined;
  if (g && g.version === 2) growthMs = (d.xp as number) * MINUTE;
  else {
    const old = [0, 30, 60, 100, 250];
    let i = 0;
    old.forEach((n, k) => {
      if ((d.xp as number) >= n) i = k;
    });
    growthMs = LEGACY_STAGE_MS[i];
  }
  const base = createState(now);
  const acc = d.accessory;
  const meals = Number.isSafeInteger(d.meals) && (d.meals as number) >= 0 ? (d.meals as number) : 0;
  let state: PipState = {
    ...base,
    growthMs: Math.min(growthMs, 400 * DAY),
    fullness: d.fullness as number,
    meals,
    importedFrom: LEGACY_KEY,
    memories: [{ id: `imported-${now}`, at: now, kind: 'imported' }, ...base.memories],
  };
  if (typeof acc === 'string' && ['bow', 'scarf', 'leaf', 'star'].includes(acc)) state = { ...state, accessory: acc as AccessoryId };
  if (state.accessory && !unlockedAccessories(state).includes(state.accessory)) state = { ...state, accessory: null };
  return state;
}
