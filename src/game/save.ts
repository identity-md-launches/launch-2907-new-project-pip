import { createState, LEGACY_KEY, migrateLegacy, validate, type PipState } from './engine';

/** Isolated namespace: the rebuild never writes any key the old site used. */
export const SAVE_KEY = 'pip-rebuild-save-v1';

export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export function browserStore(): KV | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export interface Loaded {
  state: PipState;
  source: 'saved' | 'new' | 'corrupt';
  legacyAvailable: boolean;
}

export function load(store: KV | null, now: number): Loaded {
  let legacyAvailable = false;
  try {
    legacyAvailable = !!store?.getItem(LEGACY_KEY);
  } catch {
    /* unreadable storage */
  }
  try {
    const raw = store?.getItem(SAVE_KEY);
    if (raw) {
      const v = validate(JSON.parse(raw));
      if (v) return { state: v, source: 'saved', legacyAvailable };
      return { state: createState(now), source: 'corrupt', legacyAvailable };
    }
  } catch {
    return { state: createState(now), source: 'corrupt', legacyAvailable };
  }
  return { state: createState(now), source: 'new', legacyAvailable };
}

/** Writes and reads back. Callers must only apply (and reward) a change when this returns true. */
export function commit(store: KV | null, state: PipState): boolean {
  if (!store) return false;
  try {
    const text = JSON.stringify(state);
    store.setItem(SAVE_KEY, text);
    return store.getItem(SAVE_KEY) === text;
  } catch {
    return false;
  }
}

/** Explicit, user-confirmed import from the old site. The old key is read only. */
export function importLegacy(store: KV | null, now: number): PipState | null {
  try {
    const raw = store?.getItem(LEGACY_KEY);
    return raw ? migrateLegacy(raw, now) : null;
  } catch {
    return null;
  }
}

export function exportSave(state: PipState): string {
  return JSON.stringify({ format: 'pip-rebuild-save', version: 1, state });
}

export function parseBackup(text: string): PipState | null {
  try {
    const d = JSON.parse(text);
    if (d?.format === 'pip-rebuild-save') return validate(d.state);
    return null;
  } catch {
    return null;
  }
}
