import { useEffect, useRef, useState } from 'react';
import type { GameId } from '../game/engine';
import { ShapeIcon, SHAPES } from './icons';
import type { T } from './types';

function shuffle<X>(a: X[]): X[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function MemoryGame({ t, disabled, onStart, onEnd }: { t: T; disabled: boolean; onStart: () => number | null; onEnd: (g: GameId, won: boolean, round: number) => void }) {
  const [deck, setDeck] = useState<(typeof SHAPES)[number][] | null>(null);
  const [open, setOpen] = useState<number[]>([]);
  const [found, setFound] = useState<number[]>([]);
  const [misses, setMisses] = useState(0);
  const [result, setResult] = useState<'won' | 'lost' | null>(null);
  // The round this component owns, and its pending resolution timer. An unmounted or restarted
  // round can never finish (or unlock) a newer game: the timer is cleared and the round id checked.
  const round = useRef<number | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      round.current = null;
    },
    [],
  );

  const start = () => {
    const r = onStart();
    if (r === null) return;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    round.current = r;
    setDeck(shuffle([...SHAPES, ...SHAPES]));
    setOpen([]);
    setFound([]);
    setMisses(0);
    setResult(null);
  };
  const flip = (i: number) => {
    if (!deck || result || open.includes(i) || found.includes(i) || open.length === 2) return;
    const next = [...open, i];
    setOpen(next);
    if (next.length === 2) {
      const [a, b] = next;
      const mine = round.current;
      timer.current = window.setTimeout(() => {
        timer.current = null;
        if (mine === null || round.current !== mine) return;
        if (deck[a] === deck[b]) {
          const f = [...found, a, b];
          setFound(f);
          if (f.length === deck.length) {
            setResult('won');
            round.current = null;
            onEnd('memory', true, mine);
          }
        } else {
          const m = misses + 1;
          setMisses(m);
          if (m > 6) {
            setResult('lost');
            round.current = null;
            onEnd('memory', false, mine);
          }
        }
        setOpen([]);
      }, 650);
    }
  };
  return (
    <div className="game">
      <h3>{t('memoryGame')}</h3>
      <p className="muted">{t('memoryHelp')}</p>
      {deck && (
        <>
          <p className="num" aria-live="polite">
            {t('misses', { n: misses })}
            {result && ` · ${t(result === 'won' ? 'won' : 'lost')}`}
          </p>
          <div className="grid grid-4">
            {deck.map((s, i) => {
              const shown = open.includes(i) || found.includes(i) || !!result;
              return (
                <button key={i} className={`tile${shown ? ' tile-open' : ''}`} onClick={() => flip(i)} aria-label={shown ? `${t('card', { n: i + 1 })}: ${t(`shape_${s}`)}` : t('card', { n: i + 1 })} disabled={found.includes(i)}>
                  {shown && <ShapeIcon shape={s} />}
                </button>
              );
            })}
          </div>
        </>
      )}
      {(!deck || result) && (
        <button className="btn" onClick={start} disabled={disabled}>
          {deck ? t('playAgain') : t('start')}
        </button>
      )}
    </div>
  );
}

export function SeedHunt({ t, disabled, onStart, onEnd }: { t: T; disabled: boolean; onStart: () => number | null; onEnd: (g: GameId, won: boolean, round: number) => void }) {
  const [seeds, setSeeds] = useState<number[] | null>(null);
  const [dug, setDug] = useState<number[]>([]);
  const [result, setResult] = useState<'won' | 'lost' | null>(null);
  const round = useRef<number | null>(null);
  useEffect(
    () => () => {
      round.current = null;
    },
    [],
  );
  const start = () => {
    const r = onStart();
    if (r === null) return;
    round.current = r;
    setSeeds(shuffle([...Array(12).keys()]).slice(0, 3));
    setDug([]);
    setResult(null);
  };
  const dig = (i: number) => {
    if (!seeds || result || dug.includes(i) || round.current === null) return;
    const mine = round.current;
    const d = [...dug, i];
    setDug(d);
    const foundAll = seeds.every((s) => d.includes(s));
    if (foundAll) {
      setResult('won');
      round.current = null;
      onEnd('seeds', true, mine);
    } else if (d.length >= 6) {
      setResult('lost');
      round.current = null;
      onEnd('seeds', false, mine);
    }
  };
  return (
    <div className="game">
      <h3>{t('seedGame')}</h3>
      <p className="muted">{t('seedHelp')}</p>
      {seeds && (
        <>
          <p className="num" aria-live="polite">
            {t('digs', { n: 6 - dug.length })}
            {result && ` · ${t(result === 'won' ? 'won' : 'lost')}`}
          </p>
          <div className="grid grid-4">
            {[...Array(12).keys()].map((i) => {
              const open = dug.includes(i) || !!result;
              const seed = seeds.includes(i);
              return (
                <button key={i} className={`tile bedding${open ? ' tile-open' : ''}`} onClick={() => dig(i)} aria-label={`${t('tile', { n: i + 1 })}${open ? (seed ? `: ${t('seed')}` : ': -') : ''}`} disabled={dug.includes(i)}>
                  {open && seed && <ShapeIcon shape="seed" />}
                </button>
              );
            })}
          </div>
        </>
      )}
      {(!seeds || result) && (
        <button className="btn" onClick={start} disabled={disabled}>
          {seeds ? t('playAgain') : t('start')}
        </button>
      )}
    </div>
  );
}
