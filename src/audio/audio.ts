// Opt-in sound. Nothing loads or plays until the visitor turns sound on.
export const SOUNDS = ['ball', 'brush', 'cuddle', 'dance', 'feed', 'pet', 'sleep', 'sniff', 'success', 'wake'] as const;
export type SoundId = (typeof SOUNDS)[number];
export const PREF_KEY = 'pip-rebuild-sound-v1';

export interface SoundPrefs {
  enabled: boolean;
  music: number;
  effects: number;
}
export type LoadState = 'off' | 'loading' | 'ready' | 'failed';

export function readPrefs(): SoundPrefs {
  try {
    const d = JSON.parse(localStorage.getItem(PREF_KEY) || 'null');
    if (d && typeof d.music === 'number' && typeof d.effects === 'number')
      return { enabled: false, music: Math.min(1, Math.max(0, d.music)), effects: Math.min(1, Math.max(0, d.effects)) };
  } catch {
    /* defaults */
  }
  return { enabled: false, music: 0.45, effects: 0.8 };
}

/** Ducked music level: rest and chat lower the music so Pip (and you) can think. */
export const duckedLevel = (music: number, reasons: Set<string>) => (reasons.size ? music * 0.3 : music);

export class AudioEngine {
  prefs: SoundPrefs = readPrefs();
  state: LoadState = 'off';
  loaded = 0;
  private ctx: AudioContext | null = null;
  private musicGain: GainNode | null = null;
  private fxGain: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private music: AudioBufferSourceNode | null = null;
  private abort: AbortController | null = null;
  private duck = new Set<string>();
  private hidden = false;

  constructor(private base: string, private onChange: () => void) {}

  private persist() {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({ music: this.prefs.music, effects: this.prefs.effects }));
    } catch {
      /* sound still works without remembering levels */
    }
  }

  async enable() {
    this.prefs = { ...this.prefs, enabled: true };
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.musicGain = this.ctx.createGain();
      this.fxGain = this.ctx.createGain();
      this.musicGain.connect(this.ctx.destination);
      this.fxGain.connect(this.ctx.destination);
    }
    this.apply();
    if (!this.hidden) await this.ctx.resume().catch(() => undefined);
    if (this.state !== 'ready') await this.load();
    this.startMusic();
    this.onChange();
  }

  disable() {
    this.prefs = { ...this.prefs, enabled: false };
    this.abort?.abort();
    if (this.state === 'loading') this.state = 'off';
    this.music?.stop();
    this.music = null;
    void this.ctx?.suspend();
    this.onChange();
  }

  cancel() {
    this.disable();
  }

  async load() {
    if (!this.ctx) return;
    this.abort?.abort();
    const ac = new AbortController();
    this.abort = ac;
    this.state = 'loading';
    this.loaded = 0;
    this.onChange();
    try {
      const names = ['seedlight', ...SOUNDS];
      await Promise.all(
        names.map(async (n) => {
          if (this.buffers.has(n)) {
            this.loaded++;
            return;
          }
          const r = await fetch(`${this.base}audio/${n}.flac`, { signal: ac.signal });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const buf = await this.ctx!.decodeAudioData(await r.arrayBuffer());
          if (ac.signal.aborted) return;
          this.buffers.set(n, buf);
          this.loaded++;
          this.onChange();
        }),
      );
      if (ac.signal.aborted) return;
      this.state = 'ready';
    } catch {
      if (!ac.signal.aborted) this.state = 'failed';
    }
    this.onChange();
  }

  /** Retry after a failed download: on success the enabled sound state is fully restored. */
  async retry() {
    await this.load();
    if (this.state === 'ready' && this.prefs.enabled && !this.hidden) {
      await this.ctx?.resume().catch(() => undefined);
      this.startMusic(); // guarded: never starts a second looping source
      this.onChange();
    }
  }

  private startMusic() {
    if (!this.ctx || !this.musicGain || this.music || this.state !== 'ready' || !this.prefs.enabled) return;
    const b = this.buffers.get('seedlight');
    if (!b) return;
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.loop = true;
    s.connect(this.musicGain);
    s.start();
    this.music = s;
  }

  private apply() {
    if (!this.ctx || !this.musicGain || !this.fxGain) return;
    const t = this.ctx.currentTime;
    this.musicGain.gain.setTargetAtTime(duckedLevel(this.prefs.music, this.duck) * 0.6, t, 0.25);
    this.fxGain.gain.setTargetAtTime(this.prefs.effects, t, 0.05);
  }

  setVolume(kind: 'music' | 'effects', v: number) {
    this.prefs = { ...this.prefs, [kind]: Math.min(1, Math.max(0, v)) };
    this.persist();
    this.apply();
    this.onChange();
  }

  setDuck(reason: string, on: boolean) {
    if (on) this.duck.add(reason);
    else this.duck.delete(reason);
    this.apply();
  }

  /** Background tabs stay silent. */
  setHidden(h: boolean) {
    this.hidden = h;
    if (!this.ctx) return;
    if (h) void this.ctx.suspend();
    else if (this.prefs.enabled) void this.ctx.resume();
  }

  play(id: SoundId) {
    if (!this.prefs.enabled || this.hidden || !this.ctx || !this.fxGain) return;
    const b = this.buffers.get(id);
    if (!b) return;
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.connect(this.fxGain);
    s.start();
  }
}
