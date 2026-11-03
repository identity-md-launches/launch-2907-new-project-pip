import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  advance, care, equip, feed, finishGame, nap, nextStageIn, pet, stageIndex, STAGES, unlockedAccessories, wake,
  type AccessoryId, type CareAction, type FoodId, type GameId, type Gesture, type Part, type PipState, type Result,
} from './game/engine';
import { browserStore, commit, exportSave, importLegacy, load, parseBackup } from './game/save';
import { LANG_KEY, translate, type Key, type Lang } from './i18n';
import { PetScene } from './scene/PetScene';
import { EXPRESSIONS, touchClip } from './scene/pose';
import { Stage } from './ui/Stage';
import type { FloatCard, T } from './ui/types';
import { MemoryGame, SeedHunt } from './ui/Games';
import { ChatPanel } from './ui/ChatPanel';
import { ChainPanel } from './ui/ChainPanel';
import { ChatClient, type ChatState } from './chat/client';
import { ChainMonitor, PublicRPC, type Snapshot } from './chain/monitor';
import { networkLabel, POLICY, SOURCES, txURL } from './chain/config';
import type { ChainEvent } from './chain/protocol';
import { AudioEngine, type SoundId } from './audio/audio';
import { SoundIcon } from './ui/icons';

const store = browserStore();
const BASE = import.meta.env.BASE_URL;
const CHAIN_PREF = 'pip-rebuild-chain-v1';
const KEY_GESTURES: Record<string, Gesture> = { KeyH: 'hold', KeyS: 'stroke', KeyT: 'tripleTap' };
type Tab = 'care' | 'play' | 'chat' | 'chain' | 'more';

function initialLang(): Lang {
  try {
    const s = localStorage.getItem(LANG_KEY);
    if (s === 'en' || s === 'zh-Hant') return s;
  } catch {
    /* default */
  }
  return 'en';
}

function fmtDuration(ms: number, lang: Lang) {
  const h = Math.floor(ms / 3_600_000);
  const d = Math.floor(h / 24);
  const m = Math.ceil((ms % 3_600_000) / 60_000);
  if (lang === 'zh-Hant') return d ? `${d} 天 ${h % 24} 小時` : h ? `${h} 小時 ${m} 分` : `${m} 分`;
  return d ? `${d}d ${h % 24}h` : h ? `${h}h ${m}m` : `${m}m`;
}

export default function App() {
  const [lang, setLang] = useState<Lang>(initialLang);
  const t: T = useCallback((k: Key, v?: Record<string, string | number>) => translate(lang, k, v), [lang]);
  const loaded = useMemo(() => load(store, Date.now()), []);
  const [pip, setPip] = useState<PipState>(() => advance(loaded.state, Date.now()));
  const pipRef = useRef(pip);
  pipRef.current = pip;
  const [now, setNow] = useState(Date.now());
  const [tab, setTab] = useState<Tab>('care');
  const [mode, setMode] = useState<'pet' | 'turn'>('pet');
  const [preview, setPreview] = useState<number | null>(null);
  const [cards, setCards] = useState<FloatCard[]>([]);
  const [message, setMessage] = useState('');
  const [invite, setInvite] = useState<'highFive' | 'nuzzle' | null>(null);
  const [eating, setEating] = useState(false);
  const [gameActive, setGameActive] = useState(false);
  const sceneRef = useRef<PetScene | null>(null);
  const eatingRef = useRef(false);
  const gameRef = useRef(false);
  const queue = useRef<{ clip: string }[]>([]);
  const inviteAt = useRef(0);

  // ---- persistence on open: offline progress is saved once, the old site's key is never touched
  useEffect(() => {
    if (loaded.source !== 'saved' || pip !== loaded.state) commit(store, pip);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang === 'zh-Hant' ? 'zh-Hant' : 'en';
    document.title = lang === 'zh-Hant' ? 'Pip 小倉鼠 · Squeekchain 夥伴' : 'Pip · Squeekchain hamster companion';
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      /* not remembered */
    }
  }, [lang]);

  const view = advance(pip, now);
  const realStage = stageIndex(view.growthMs);
  const shownStage = preview ?? realStage;

  // ---- sound --------------------------------------------------------------------------------
  const [, setSoundTick] = useState(0);
  const audio = useMemo(() => new AudioEngine(BASE, () => setSoundTick((n) => n + 1)), []);
  const [soundOpen, setSoundOpen] = useState(false);
  const sfx = (id: SoundId) => audio.play(id);

  // ---- cards --------------------------------------------------------------------------------
  const addCard = useCallback((c: Omit<FloatCard, 'id' | 'at'>) => {
    const card: FloatCard = { ...c, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, at: Date.now() };
    setCards((cs) => [card, ...cs].slice(0, 3));
    window.setTimeout(() => setCards((cs) => cs.filter((x) => x.id !== card.id)), c.kind === 'local' ? 5000 : 9000);
  }, []);
  const dismissCard = (id: string) => setCards((cs) => cs.filter((c) => c.id !== id));

  // ---- the one way state changes: validated, saved, then shown --------------------------------
  const reasonText = (r: Result) => (r.reason === 'cooldown' ? t('r_cooldown', { s: Math.ceil((r.retryInMs ?? 0) / 1000) }) : t(`r_${r.reason}` as Key));
  const applyResult = (r: Result): boolean => {
    if (!r.ok) {
      setMessage(reasonText(r));
      return false;
    }
    if (!commit(store, r.state)) {
      setMessage(t('saveFailed'));
      return false;
    }
    setPip(r.state);
    if (r.wishDone) setMessage(t('wishGranted', { w: t(`wish_${r.wishDone}` as Key) }));
    else if (r.bondGained > 0) setMessage(t('bondPlus', { b: r.bondGained }));
    return true;
  };
  const busy = (): Result['reason'] | null => {
    if (advance(pipRef.current, Date.now()).asleep) return 'asleep';
    if (eatingRef.current || gameRef.current) return 'busy';
    return null;
  };

  // ---- feeding --------------------------------------------------------------------------------
  const tryFeed = (food: FoodId): boolean => {
    if (preview !== null) return false;
    const b = busy();
    if (b === 'busy') {
      setMessage(t('r_busy'));
      return false;
    }
    const r = feed(pipRef.current, food, Date.now());
    if (!applyResult(r)) return false;
    eatingRef.current = true;
    setEating(true);
    const scene = sceneRef.current;
    if (scene) scene.startEating(food);
    // The lock is released only when the scene reports the eat clip ended (onClipEnd below). The
    // scene clock pauses in a hidden tab and runs slower below 20 fps, so a wall-clock timer would
    // unlock Nap/care/games while Pip is still nibbling. Without a scene there is no clip to wait for.
    else window.setTimeout(endEating, 3600);
    sfx('feed');
    setMessage(r.bondGained ? t('ate', { food: t(food), b: r.bondGained }) : t('card_feed', { food: t(food) }));
    return true;
  };
  function endEating() {
    eatingRef.current = false;
    setEating(false);
  }
  const onClipEnd = (name: string) => {
    if (name === 'eat' && eatingRef.current) endEating();
  };

  // ---- touch --------------------------------------------------------------------------------
  const onTouch = (part: Part, gesture: Gesture) => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (scene.busyPriority() >= 4) return; // eating outranks touch
    if (preview !== null) {
      scene.play(touchClip(part, gesture));
      return;
    }
    if (gameRef.current) {
      setMessage(t('r_busy'));
      return;
    }
    let answered: string | null = null;
    if (invite === 'highFive' && part === 'paw') answered = 'highFiveDone';
    if (invite === 'nuzzle' && part === 'head' && gesture !== 'tap') answered = 'nuzzleDone';
    const r = pet(pipRef.current, part, gesture, Date.now());
    if (!r.ok) {
      setMessage(reasonText(r));
      return;
    }
    if (!applyResult(r)) return;
    if (answered) {
      scene.stopClip(invite!);
      setInvite(null);
      scene.play(answered === 'highFiveDone' ? 'happyHop' : 'cuddle', { force: true });
      sfx('success');
      addCard({ kind: 'local', title: t(answered as Key), why: t('card_touch', { part: t(`part_${part}` as Key) }) });
      return;
    }
    scene.play(touchClip(part, gesture));
    sfx(part === 'nose' ? 'sniff' : 'pet');
    addCard({
      kind: 'local',
      title: t('card_touch', { part: t(`part_${part}` as Key) }),
      why: r.bondGained ? t('bondPlus', { b: r.bondGained }) : t('noReward'),
    });
  };

  // ---- care ---------------------------------------------------------------------------------
  const doCare = (a: CareAction) => {
    if (busy() === 'busy') return setMessage(t('r_busy'));
    if (!applyResult(care(pipRef.current, a, Date.now()))) return;
    sceneRef.current?.play(a === 'dance' ? 'spinDance' : a, { force: true });
    sfx(a);
  };
  const doNap = () => {
    if (eatingRef.current || gameRef.current) return setMessage(t('r_busy'));
    if (!applyResult(nap(pipRef.current, Date.now()))) return;
    sfx('sleep');
  };
  const doWake = () => {
    if (!applyResult(wake(pipRef.current, Date.now()))) return;
    sfx('wake');
    sceneRef.current?.play('i_stretch', { force: true });
  };

  useEffect(() => {
    sceneRef.current?.setAsleep(view.asleep && preview === null);
    sceneRef.current?.setEnergy(view.energy);
    audio.setDuck('rest', view.asleep);
  }, [view.asleep, view.energy, preview, audio]);
  useEffect(() => sceneRef.current?.setAccessory(preview === null ? view.accessory : STAGES[shownStage].accessory), [view.accessory, preview, shownStage]);

  // ---- games --------------------------------------------------------------------------------
  // Each round gets an id; only the round that holds the lock can finish it and release it.
  const roundSeq = useRef(0);
  const activeRound = useRef<number | null>(null);
  const gameStart = (): number | null => {
    const b = busy();
    if (b) {
      setMessage(b === 'asleep' ? t('r_asleep') : t('r_busy'));
      return null;
    }
    const id = ++roundSeq.current;
    activeRound.current = id;
    gameRef.current = true;
    setGameActive(true);
    sceneRef.current?.play('i_attention');
    return id;
  };
  const gameEnd = (g: GameId, won: boolean, round: number) => {
    if (activeRound.current !== round) return; // abandoned or superseded round: no unlock, no reward
    activeRound.current = null;
    gameRef.current = false;
    setGameActive(false);
    const r = finishGame(pipRef.current, g, won, Date.now());
    if (!applyResult(r)) return;
    if (won) {
      sceneRef.current?.play('happyHop', { force: true });
      sfx('success');
      if (!r.bondGained) setMessage(`${t('won')} ${t('practice')}`);
    } else setMessage(t('lost'));
  };
  useEffect(() => {
    if (tab !== 'play' && gameRef.current) {
      activeRound.current = null;
      gameRef.current = false; // leaving the tab abandons the round, no reward
      setGameActive(false);
    }
  }, [tab]);

  // ---- expression queue: chain reactions wait for sleep, eating and games -------------------
  const enqueue = useCallback((clip: string) => {
    queue.current = [...queue.current, { clip }].slice(-POLICY.queue);
  }, []);
  useEffect(() => {
    const id = window.setInterval(() => {
      const s = sceneRef.current;
      if (!s || !queue.current.length) return;
      if (advance(pipRef.current, Date.now()).asleep || eatingRef.current || gameRef.current || s.busyPriority() >= 3) return;
      const next = queue.current.shift()!;
      s.play(next.clip);
    }, 500);
    return () => clearInterval(id);
  }, []);

  // ---- invitations --------------------------------------------------------------------------
  useEffect(() => {
    const id = window.setInterval(() => {
      const s = sceneRef.current;
      if (!s || document.hidden || preview !== null) return;
      if (advance(pipRef.current, Date.now()).asleep || eatingRef.current || gameRef.current || s.busyPriority() >= 2) return;
      if (Date.now() - inviteAt.current < 90_000 || Math.random() > 0.3) return;
      const which = Math.random() < 0.5 ? 'highFive' : 'nuzzle';
      if (s.play(which)) {
        inviteAt.current = Date.now();
        setInvite(which);
        window.setTimeout(() => setInvite((v) => (v === which ? null : v)), 6000);
      }
    }, 10_000);
    return () => clearInterval(id);
  }, [preview]);

  // ---- chain --------------------------------------------------------------------------------
  const [chainOn, setChainOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem(CHAIN_PREF) !== 'off';
    } catch {
      return true;
    }
  });
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const tRef = useRef(t);
  tRef.current = t;
  const monitors = useMemo(() => {
    const ms: ChainMonitor[] = [];
    const refresh = () => setSnaps(ms.map((m) => m.snapshot()));
    const describe = (e: ChainEvent, removed = false) => {
      const c = SOURCES[e.source];
      const tt = tRef.current;
      addCard({
        kind: 'live',
        chain: networkLabel(c, tt),
        title: removed ? tt('card_removed') : e.type === 'request' ? tt('card_request') : tt('card_settlement'),
        why: removed ? tt('card_removed_why') : e.type === 'request' ? tt('card_request_why') : tt('card_settlement_why', { n: e.derivedBlocksDelta ?? '?' }),
        confirm: removed ? tt('removed') : tt('confirmed', { n: c.confirmations }),
        tx: txURL(c, e.transactionHash) ?? undefined,
        txHash: e.transactionHash,
      });
    };
    for (const c of Object.values(SOURCES)) {
      ms.push(
        new ChainMonitor(c, new PublicRPC(c.rpc), {
          onEvents: (evs) =>
            evs.forEach((e) => {
              describe(e);
              enqueue(e.type === 'request' ? 'wheelSprint' : Number(e.derivedBlocksDelta ?? 0) >= 10 ? 'proudPose' : 'seedToss');
            }),
          onRemoved: (evs) =>
            evs.slice(0, 1).forEach((e) => {
              describe(e, true);
              enqueue('curiousSniff');
            }),
          onChange: refresh,
        }),
      );
    }
    refresh();
    return ms;
  }, [addCard, enqueue]);
  useEffect(() => {
    try {
      localStorage.setItem(CHAIN_PREF, chainOn ? 'on' : 'off');
    } catch {
      /* not remembered */
    }
    monitors.forEach((m) => (chainOn ? m.start() : m.stop()));
    if (!chainOn) return;
    const id = window.setInterval(() => monitors.forEach((m) => m.due() && void m.poll()), 1000);
    const vis = () => monitors.forEach((m) => (document.hidden ? m.pause() : m.resume()));
    document.addEventListener('visibilitychange', vis);
    vis();
    const staleTick = window.setInterval(() => setSnaps(monitors.map((m) => m.snapshot())), 15_000);
    return () => {
      clearInterval(id);
      clearInterval(staleTick);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [chainOn, monitors]);
  const rehearse = (kind: 'request' | 'settlement') => {
    const c = kind === 'request' ? SOURCES.imd : SOURCES.squeek;
    addCard({
      kind: 'simulated',
      chain: networkLabel(c, t),
      title: kind === 'request' ? t('card_request') : t('card_settlement'),
      why: t('card_sim_why'),
    });
    enqueue(kind === 'request' ? 'wheelSprint' : 'seedToss');
  };

  // ---- chat ---------------------------------------------------------------------------------
  const [chatState, setChatState] = useState<ChatState>({ phase: 'idle', backend: null, progress: 0, lines: [], error: '' });
  const ctxRef = useRef({ lang, view });
  ctxRef.current = { lang, view };
  const chat = useMemo(
    () =>
      new ChatClient(
        () => new Worker(new URL('./chat/worker.ts', import.meta.url), { type: 'module' }) as never,
        setChatState,
        () => {
          const { lang: l, view: v } = ctxRef.current;
          return { lang: l, stage: STAGES[stageIndex(v.growthMs)].id, bond: v.bond, energy: v.energy, fullness: v.fullness, asleep: v.asleep };
        },
      ),
    [],
  );
  useEffect(() => audio.setDuck('chat', tab === 'chat'), [tab, audio]);

  // ---- visibility, motion, keyboard ---------------------------------------------------------
  useEffect(() => {
    const vis = () => {
      sceneRef.current?.setHidden(document.hidden);
      audio.setHidden(document.hidden);
    };
    document.addEventListener('visibilitychange', vis);
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const rm = () => sceneRef.current?.setReducedMotion(mq.matches);
    rm();
    const id = window.setTimeout(rm, 500);
    mq.addEventListener('change', rm);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      mq.removeEventListener('change', rm);
      clearTimeout(id);
    };
  }, [audio]);
  const keyParts: Part[] = ['head', 'cheek', 'nose', 'belly', 'paw', 'feet'];
  const [kbPart, setKbPart] = useState<Part>('head');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        sceneRef.current?.turnBy(e.key === 'ArrowLeft' ? -0.25 : 0.25);
        e.preventDefault();
      }
      if (e.repeat) return; // a held key is one gesture, not a stream of awards
      const n = Number(e.code.replace('Digit', ''));
      if (e.code.startsWith('Digit') && n >= 1 && n <= 6) {
        const part = keyParts[n - 1];
        setKbPart(part);
        sceneRef.current?.touchPartByKey(part, e.shiftKey ? 'stroke' : 'tap');
        return;
      }
      const g = KEY_GESTURES[e.code];
      if (g) {
        e.preventDefault();
        sceneRef.current?.touchPartByKey(kbPart, g);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---- save management ----------------------------------------------------------------------
  const fileRef = useRef<HTMLInputElement>(null);
  const doImport = () => {
    const s = importLegacy(store, Date.now());
    if (!s) return setMessage(t('importNone'));
    if (!window.confirm(t('confirmImport'))) return;
    if (!commit(store, s)) return setMessage(t('saveFailed'));
    setPip(s);
    setMessage(t('importDone'));
  };
  const doExport = () => {
    const blob = new Blob([exportSave(pipRef.current)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pip-backup.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const doRestore = async (f: File | undefined) => {
    if (!f) return;
    const s = parseBackup(await f.text());
    if (!s) return setMessage(t('restoreBad'));
    if (!commit(store, s)) return setMessage(t('saveFailed'));
    setPip(s);
  };

  const stageName = t(STAGES[shownStage].id as Key);
  const nextIn = nextStageIn(view);
  const badge = view.asleep && preview === null ? t('asleepBadge') : eating ? t('eatingBadge') : null;
  const unlocked = unlockedAccessories(view);
  const blocked = view.asleep || eating || gameActive;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>Pip</h1>
          <p className="tagline">{t('tagline')}</p>
        </div>
        <div className="top-controls">
          <button className="icon-btn" onClick={() => setLang(lang === 'en' ? 'zh-Hant' : 'en')} aria-label={t('languageLabel')} lang={lang === 'en' ? 'zh-Hant' : 'en'}>
            {t('language')}
          </button>
          <div className="sound">
            <button
              className="icon-btn"
              aria-pressed={audio.prefs.enabled}
              aria-label={audio.prefs.enabled ? t('soundOff') : t('soundOn')}
              onClick={() => {
                if (audio.prefs.enabled) audio.disable();
                else void audio.enable();
                setSoundOpen(!audio.prefs.enabled);
              }}
            >
              <SoundIcon on={audio.prefs.enabled} />
            </button>
            {audio.prefs.enabled && (
              <button className="icon-btn" aria-expanded={soundOpen} aria-controls="sound-panel" onClick={() => setSoundOpen(!soundOpen)} aria-label={t('sound')}>
                <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14M5 16h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><circle cx="9" cy="8" r="2.4" fill="currentColor" /><circle cx="15" cy="16" r="2.4" fill="currentColor" /></svg>
              </button>
            )}
            {soundOpen && audio.prefs.enabled && (
              <div className="sound-panel" id="sound-panel">
                {audio.state === 'loading' && (
                  <p className="small" role="status">
                    {t('soundLoading')} <button className="link" onClick={() => audio.cancel()}>{t('cancel')}</button>
                  </p>
                )}
                {audio.state === 'failed' && (
                  <p className="small warn" role="alert">
                    {t('soundFailed')} <button className="link" onClick={() => void audio.retry()}>{t('retry')}</button>
                  </p>
                )}
                {(['music', 'effects'] as const).map((k) => (
                  <label key={k} className="slider">
                    <span>{t(k)}</span>
                    <input type="range" min={0} max={1} step={0.05} value={audio.prefs[k]} onChange={(e) => audio.setVolume(k, Number(e.target.value))} />
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="layout">
        <Stage
          t={t}
          sceneRef={sceneRef}
          modelUrl={`${BASE}${STAGES[shownStage].model}`}
          stage={shownStage}
          mode={mode}
          setMode={setMode}
          onTouch={onTouch}
          onClipEnd={onClipEnd}
          tryFeed={tryFeed}
          cards={cards}
          dismissCard={dismissCard}
          badge={badge}
          invite={invite ? t(invite === 'highFive' ? 'inviteHighFive' : 'inviteNuzzle') : null}
          bars={{ bond: view.bond, energy: view.energy, fullness: view.fullness }}
          stageLabel={preview !== null ? `${stageName} · ${t('previewStages')}` : stageName}
          preview={preview !== null}
        />
        <p className="toast" role="status" aria-live="polite">
          {message}
        </p>

        <section className="panel" aria-label={t('tabCare')}>
          <div className="tabs" role="tablist">
            {(['care', 'play', 'chat', 'chain', 'more'] as Tab[]).map((k) => (
              <button key={k} role="tab" id={`tab-${k}`} aria-selected={tab === k} aria-controls="tabpanel" className="tab" onClick={() => setTab(k)}>
                {t(k === 'care' ? 'tabCare' : k === 'play' ? 'tabPlay' : k === 'chat' ? 'tabChat' : k === 'chain' ? 'tabChain' : 'tabMore')}
              </button>
            ))}
          </div>
          <div id="tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="tabpanel">
            {tab === 'care' && (
              <>
                <div className="actions">
                  {(['cuddle', 'brush', 'ball', 'dance'] as CareAction[]).map((a) => (
                    <button key={a} className="btn" onClick={() => doCare(a)} disabled={preview !== null || blocked}>
                      {t(a)}
                    </button>
                  ))}
                  {view.asleep ? (
                    <button className="btn btn-primary" onClick={doWake} disabled={preview !== null}>
                      {t('wake')}
                    </button>
                  ) : (
                    <button className="btn" onClick={doNap} disabled={preview !== null || eating || gameActive}>
                      {t('nap')}
                    </button>
                  )}
                </div>
                <p className="small muted">
                  {t('stage')}: {t(STAGES[realStage].id as Key)} · {nextIn === null ? t('finalStage') : t('nextStage', { t: fmtDuration(nextIn, lang) })}
                </p>
                <h2>{t('wishes')}</h2>
                <ul className="wishes">
                  {view.wishes.map((w) => (
                    <li key={w.id} data-done={w.done}>
                      <span className="check" aria-hidden="true">{w.done && <svg viewBox="0 0 16 16" width="12" height="12"><path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" /></svg>}</span>
                      <span>{t(`wish_${w.id}` as Key)}</span>
                      <span className="sr-only">{w.done ? 'done' : ''}</span>
                    </li>
                  ))}
                </ul>
                <h2>{t('keyboardTitle')}</h2>
                <p className="small muted">{t('keyboardHelp')}</p>
                <div className="actions">
                  {keyParts.map((part) => (
                    <button
                      key={part}
                      className="btn btn-quiet"
                      aria-pressed={kbPart === part}
                      onClick={() => {
                        setKbPart(part);
                        sceneRef.current?.touchPartByKey(part, 'tap');
                      }}
                    >
                      {t('touchPart', { part: t(`part_${part}` as Key) })}
                    </button>
                  ))}
                </div>
                <p className="small muted" aria-live="polite">{t('kbPart', { part: t(`part_${kbPart}` as Key) })}</p>
                <div className="actions">
                  {(['hold', 'stroke', 'tripleTap'] as Gesture[]).map((g) => (
                    <button key={g} className="btn btn-quiet" onClick={() => sceneRef.current?.touchPartByKey(kbPart, g)}>
                      {t(g === 'hold' ? 'kbHold' : g === 'stroke' ? 'kbStroke' : 'kbTriple')}
                    </button>
                  ))}
                </div>
              </>
            )}
            {tab === 'play' && (
              <>
                <MemoryGame t={t} disabled={preview !== null} onStart={gameStart} onEnd={gameEnd} />
                <SeedHunt t={t} disabled={preview !== null} onStart={gameStart} onEnd={gameEnd} />
                <h2>{t('expressions')}</h2>
                <p className="small muted">{t('expressionsHelp')}</p>
                <div className="actions">
                  {EXPRESSIONS.map((x) => (
                    <button
                      key={x}
                      className="btn btn-quiet"
                      onClick={() => {
                        if (sceneRef.current?.play(x)) addCard({ kind: 'simulated', title: t(`exp_${x}` as Key), why: t('card_sim_why') });
                        else setMessage(view.asleep ? t('r_asleep') : t('r_busy'));
                      }}
                    >
                      {t(`exp_${x}` as Key)}
                    </button>
                  ))}
                </div>
              </>
            )}
            {tab === 'chat' && <ChatPanel t={t} client={chat} state={chatState} you={t('you')} />}
            {tab === 'chain' && <ChainPanel t={t} lang={lang} enabled={chainOn} setEnabled={setChainOn} snaps={snaps} rehearse={rehearse} />}
            {tab === 'more' && (
              <>
                <h2>{t('rulesTitle')}</h2>
                <ul className="rules">
                  {(['rules1', 'rules2', 'rules3', 'rules4', 'rules5'] as Key[]).map((k) => (
                    <li key={k}>{t(k)}</li>
                  ))}
                </ul>
                <h2>{t('accessories')}</h2>
                <div className="actions" role="radiogroup" aria-label={t('accessories')}>
                  {([null, 'bow', 'scarf', 'leaf', 'star'] as (AccessoryId | null)[]).map((a) => {
                    const st = STAGES.find((s) => s.accessory === a);
                    const ok = a === null || unlocked.includes(a);
                    return (
                      <button key={a ?? 'none'} role="radio" aria-checked={view.accessory === a} className="btn btn-quiet" disabled={!ok} onClick={() => applyResult(equip(pipRef.current, a, Date.now()))} title={ok ? undefined : t('locked', { stage: t(st!.id as Key) })}>
                        {t(`acc_${a ?? 'none'}` as Key)}
                        {!ok && <span className="small muted"> · {t('locked', { stage: t(st!.id as Key) })}</span>}
                      </button>
                    );
                  })}
                </div>
                <h2>{t('previewStages')}</h2>
                <p className="small muted">{t('previewNote')}</p>
                <div className="actions">
                  <button className="btn btn-quiet" aria-pressed={preview === null} onClick={() => setPreview(null)}>
                    {t('previewOff')}
                  </button>
                  {STAGES.map((s, i) => (
                    <button key={s.id} className="btn btn-quiet" aria-pressed={preview === i} onClick={() => setPreview(i)}>
                      {i + 1}. {t(s.id as Key)}
                    </button>
                  ))}
                </div>
                <h2>{t('memories')}</h2>
                <ul className="memories">
                  {view.memories.map((m) => (
                    <li key={m.id}>
                      <span>{t((`mem_${m.kind.startsWith('wishes-') ? 'wishes' : m.kind}`) as Key)}</span>
                      <time className="small muted num" dateTime={new Date(m.at).toISOString()}>
                        {new Date(m.at).toLocaleDateString(lang === 'zh-Hant' ? 'zh-TW' : 'en')}
                      </time>
                    </li>
                  ))}
                </ul>
                <h2>{t('saveTitle')}</h2>
                <p className="small muted">{t('saveInfo')}</p>
                <div className="actions">
                  {loaded.legacyAvailable && (
                    <button className="btn" onClick={doImport}>
                      {t('importOld')}
                    </button>
                  )}
                  <button className="btn" onClick={doExport}>
                    {t('exportSave')}
                  </button>
                  <button className="btn" onClick={() => fileRef.current?.click()}>
                    {t('restoreSave')}
                  </button>
                  <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => void doRestore(e.target.files?.[0])} />
                </div>
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
