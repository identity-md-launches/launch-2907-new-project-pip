import { useEffect, useRef, useState } from 'react';
import type { FoodId, Gesture, Part } from '../game/engine';
import { PetScene } from '../scene/PetScene';
import type { FloatCard, T } from './types';
import { FoodIcon } from './icons';

export const ACCEPT_RADIUS = 56; // px from the live mouth socket

export function proximityOf(dist: number) {
  return Math.max(0, Math.min(1, 1 - (dist - ACCEPT_RADIUS) / 160));
}

interface Props {
  t: T;
  sceneRef: React.MutableRefObject<PetScene | null>;
  modelUrl: string;
  stage: number;
  mode: 'pet' | 'turn';
  setMode: (m: 'pet' | 'turn') => void;
  onTouch: (part: Part, gesture: Gesture) => void;
  tryFeed: (food: FoodId) => boolean;
  cards: FloatCard[];
  dismissCard: (id: string) => void;
  badge: string | null;
  invite: string | null;
  bars: { bond: number; energy: number; fullness: number };
  stageLabel: string;
  preview: boolean;
}

export function Stage(p: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [load, setLoad] = useState<'loading' | 'ok' | 'failed' | 'nogl'>('loading');
  const [loadKey, setLoadKey] = useState(0);
  const [drag, setDrag] = useState<{ food: FoodId; x: number; y: number; near: number } | null>(null);
  const cbRef = useRef(p.onTouch);
  cbRef.current = p.onTouch;

  useEffect(() => {
    const c = canvasRef.current!;
    let scene: PetScene;
    try {
      scene = new PetScene(c, {
        onTouch: (part, g) => cbRef.current(part, g),
        onLoad: (ok) => setLoad(ok ? 'ok' : 'failed'),
      });
    } catch {
      setLoad('nogl');
      return;
    }
    p.sceneRef.current = scene;
    (window as unknown as { __pip?: PetScene }).__pip = scene; // test hook (read-only use in e2e)
    return () => {
      scene.dispose();
      p.sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const s = p.sceneRef.current;
    if (!s) return;
    setLoad('loading');
    s.load(p.stage, p.modelUrl);
  }, [p.modelUrl, p.stage, loadKey, p.sceneRef]);

  useEffect(() => p.sceneRef.current?.setMode(p.mode), [p.mode, p.sceneRef]);

  // ---- snack dragging to the live mouth socket ----------------------------------------------
  const dragRef = useRef<{ food: FoodId; id: number } | null>(null);
  const measure = (x: number, y: number) => {
    const m = p.sceneRef.current?.mouthScreen();
    return m ? Math.hypot(m.x - x, m.y - y) : Infinity;
  };
  const onSnackDown = (food: FoodId) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { food, id: e.pointerId };
    setDrag({ food, x: e.clientX, y: e.clientY, near: 0 });
  };
  const onSnackMove = (e: React.PointerEvent) => {
    if (!dragRef.current || dragRef.current.id !== e.pointerId) return;
    const near = proximityOf(measure(e.clientX, e.clientY));
    p.sceneRef.current?.setProximity(near);
    setDrag({ food: dragRef.current.food, x: e.clientX, y: e.clientY, near });
  };
  const endDrag = () => {
    dragRef.current = null;
    setDrag(null);
    p.sceneRef.current?.setProximity(0);
  };
  const onSnackUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const dist = measure(e.clientX, e.clientY);
    endDrag();
    if (dist <= ACCEPT_RADIUS) p.tryFeed(d.food);
  };
  const onSnackCancel = (e: React.PointerEvent) => {
    if (dragRef.current?.id === e.pointerId) endDrag(); // cancelled drags never feed
  };
  const onSnackKey = (food: FoodId) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      p.tryFeed(food);
    }
  };

  const pct = (n: number) => `${Math.round(n)}%`;
  return (
    <section className="stage" aria-label={p.t('appTitle')}>
      <canvas ref={canvasRef} className="pet-canvas" data-mode={p.mode} aria-label={p.t('modeHint')} role="img" />
      {load !== 'ok' && (
        <div className="stage-msg" role="status">
          {load === 'loading' && p.t('loading3d')}
          {load === 'nogl' && p.t('no3d')}
          {load === 'failed' && (
            <>
              <span>{p.t('failed3d')}</span>
              <button className="btn" onClick={() => setLoadKey((k) => k + 1)}>
                {p.t('retry')}
              </button>
            </>
          )}
        </div>
      )}
      <div className="stage-top">
        <div className="seg" role="group" aria-label={p.t('modeHint')}>
          {(['pet', 'turn'] as const).map((m) => (
            <button key={m} className="seg-btn" aria-pressed={p.mode === m} onClick={() => p.setMode(m)}>
              {p.t(m === 'pet' ? 'modePet' : 'modeTurn')}
            </button>
          ))}
        </div>
        <div className="stage-meta">
          <span className="stage-name">{p.stageLabel}</span>
          {p.badge && <span className="badge">{p.badge}</span>}
        </div>
      </div>
      {p.invite && (
        <p className="invite" role="status">
          {p.invite}
        </p>
      )}
      <ol className="cards" aria-live="polite" aria-label="Pip">
        {p.cards.map((c) => (
          <li key={c.id} className={`card card-${c.kind}`}>
            <div className="card-head">
              <span className={`tag tag-${c.kind}`}>{c.kind === 'simulated' ? p.t('simulated') : c.kind === 'live' ? p.t('live') : 'Pip'}</span>
              {c.chain && <span className="card-chain">{c.chain}</span>}
              <button className="card-x" aria-label={p.t('close')} onClick={() => p.dismissCard(c.id)}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
              </button>
            </div>
            <p className="card-title">{c.title}</p>
            <p className="card-why">{c.why}</p>
            {(c.confirm || c.tx) && (
              <p className="card-meta">
                {c.confirm && <span>{c.confirm}</span>}
                {c.tx && (
                  <a href={c.tx} target="_blank" rel="noopener noreferrer">
                    {p.t('viewTx')} {c.txHash ? `${c.txHash.slice(0, 8)}…${c.txHash.slice(-4)}` : ''}
                  </a>
                )}
              </p>
            )}
          </li>
        ))}
      </ol>
      <div className="stage-bottom">
        <dl className="bars">
          {(['bond', 'energy', 'fullness'] as const).map((k) => (
            <div key={k} className="bar">
              <dt>{p.t(k)}</dt>
              <dd>
                <span className="meter" aria-hidden="true">
                  <span style={{ inlineSize: pct(p.bars[k]) }} />
                </span>
                <span className="num">{pct(p.bars[k])}</span>
              </dd>
            </div>
          ))}
        </dl>
        <div className="snacks">
          <span className="snack-hint" id="snack-hint">
            {drag ? (drag.near >= 0.99 ? p.t('dropHere') : drag.near > 0.2 ? p.t('nearMouth') : p.t('snackHint')) : p.t('snackHint')}
          </span>
          <div className="snack-row">
            {(['seed', 'carrot', 'berry'] as const).map((f) => (
              <button
                key={f}
                className="snack"
                aria-describedby="snack-hint"
                disabled={p.preview}
                onPointerDown={onSnackDown(f)}
                onPointerMove={onSnackMove}
                onPointerUp={onSnackUp}
                onPointerCancel={onSnackCancel}
                onLostPointerCapture={onSnackCancel}
                onKeyDown={onSnackKey(f)}
                data-food={f}
              >
                <FoodIcon food={f} />
                <span>{p.t(f)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      {drag && (
        <div className={`ghost${drag.near >= 0.99 ? ' ghost-ok' : ''}`} style={{ left: drag.x, top: drag.y }} aria-hidden="true">
          <FoodIcon food={drag.food} />
        </div>
      )}
    </section>
  );
}
