import { describe, expect, it } from 'vitest';
import { advance, care, createState, DAY, feed, nap, pet, RULES, stageIndex, STAGES, validate } from '../src/game/engine';
import { commit, exportSave, parseBackup, SAVE_KEY, type KV } from '../src/game/save';

const T0 = Date.UTC(2026, 10, 3, 10);

describe('rules', () => {
  it('grows through all five stages by elapsed time only', () => {
    const s = createState(T0);
    expect(STAGES).toHaveLength(5);
    const at = [0, 1, 3, 7, 21].map((d) => stageIndex(d * DAY));
    expect(at).toEqual([0, 1, 2, 3, 4]);
    let x = s;
    for (let i = 0; i < 200; i++) x = pet(x, 'head', 'tap', T0 + i).state; // click-spam
    expect(stageIndex(x.growthMs)).toBe(0);
    expect(x.bond - s.bond).toBeLessThanOrEqual(1 + 3); // one touch reward + one wish
  });
  it('offline progress is capped at seven days per absence', () => {
    const s = advance(createState(T0), T0 + 30 * DAY);
    expect(s.growthMs).toBe(7 * DAY);
  });
  it('no feeding while asleep, full or on cooldown', () => {
    let s = createState(T0);
    const a = feed(s, 'seed', T0 + 1);
    expect(a.ok).toBe(true);
    expect(feed(a.state, 'seed', T0 + 2).reason).toBe('cooldown');
    s = { ...a.state, fullness: RULES.fullAt + 5 }; // stays above fullAt after 45 s of decay
    expect(feed(s, 'seed', T0 + RULES.feedCooldownMs + 10).reason).toBe('full');
    const slept = nap({ ...createState(T0), energy: 50 }, T0 + 1).state;
    expect(feed(slept, 'seed', T0 + 2).reason).toBe('asleep');
    expect(feed(createState(T0), 'pizza' as never, T0).reason).toBe('unknown-food');
  });
  it('repeated care respects cooldowns', () => {
    const a = care(createState(T0), 'brush', T0 + 1);
    expect(a.ok).toBe(true);
    expect(care(a.state, 'brush', T0 + 2).reason).toBe('cooldown');
  });
});

describe('saves', () => {
  const good = () => JSON.parse(exportSave(createState(T0)));
  it('accepts a valid backup', () => {
    expect(parseBackup(JSON.stringify(good()))).not.toBeNull();
  });
  it.each([
    ['wishes:[null]', (d: any) => (d.state.wishes = [null])],
    ['unknown wish id', (d: any) => (d.state.wishes = [{ id: 'win', done: true }])],
    ['memory null', (d: any) => (d.state.memories = [null])],
    ['memory bad kind', (d: any) => (d.state.memories = [{ id: 'x', at: 1, kind: '<img>' }])],
    ['memory timestamp 1e20', (d: any) => (d.state.memories[0].at = 1e20)],
    ['memory timestamp beyond Date limit', (d: any) => (d.state.memories[0].at = 8_640_000_000_000_001)],
    ['negative memory timestamp', (d: any) => (d.state.memories[0].at = -1)],
    ['cooldown string', (d: any) => (d.state.cooldowns = { brush: 'soon' })],
    ['cooldown unknown key', (d: any) => (d.state.cooldowns = { hack: 1 })],
    ['bad day', (d: any) => (d.state.day = 'x')],
    ['bond > 100', (d: any) => (d.state.bond = 101)],
  ])('rejects %s', (_n, mutate) => {
    const d = good();
    mutate(d);
    expect(parseBackup(JSON.stringify(d))).toBeNull();
    expect(validate(d.state)).toBeNull();
  });
  it.each(['createdAt', 'settledAt', 'updatedAt', 'lastFedAt', 'lastPetRewardAt', 'lastGameRewardAt'])(
    'rejects an out-of-range %s timestamp', (field) => {
      const d = good();
      d.state[field] = 1e20;
      expect(parseBackup(JSON.stringify(d))).toBeNull();
    },
  );
  it('rejects an out-of-range cooldown timestamp', () => {
    const d = good();
    d.state.cooldowns.brush = 1e20;
    expect(parseBackup(JSON.stringify(d))).toBeNull();
  });
  it.each([0, 8_640_000_000_000_000])('accepts the supported memory timestamp boundary %s', (at) => {
    const d = good();
    d.state.memories[0].at = at;
    const restored = parseBackup(JSON.stringify(d));
    expect(restored?.memories[0].at).toBe(at);
    expect(() => new Date(restored!.memories[0].at).toISOString()).not.toThrow();
  });
  it('a failed save reports false so callers never apply or reward', () => {
    const broken: KV = { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); } };
    expect(commit(broken, createState(T0))).toBe(false);
    expect(commit(null, createState(T0))).toBe(false);
    const mem = new Map<string, string>();
    const ok: KV = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) };
    expect(commit(ok, createState(T0))).toBe(true);
    expect([...mem.keys()]).toEqual([SAVE_KEY]);
  });
});
