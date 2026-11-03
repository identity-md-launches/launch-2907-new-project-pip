import { SOURCES, txURL } from '../chain/config';
import type { Snapshot } from '../chain/monitor';
import type { T } from './types';

function fmtTime(ms: number | null, lang: string) {
  return ms ? new Date(ms).toLocaleTimeString(lang === 'zh-Hant' ? 'zh-TW' : 'en', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
}

export function ChainPanel({
  t, lang, enabled, setEnabled, snaps, rehearse,
}: {
  t: T;
  lang: string;
  enabled: boolean;
  setEnabled: (b: boolean) => void;
  snaps: Snapshot[];
  rehearse: (kind: 'request' | 'settlement') => void;
}) {
  return (
    <div className="chain">
      <h2>{t('chainTitle')}</h2>
      <p className="muted">{t('chainIntro')}</p>
      <div className="row">
        <button className="btn" aria-pressed={enabled} onClick={() => setEnabled(!enabled)}>
          {enabled ? t('chainDisable') : t('chainEnable')}
        </button>
      </div>
      {snaps.map((s) => {
        const c = SOURCES[s.source];
        const live = s.status === 'watching';
        const stale = s.status === 'stale';
        return (
          <article key={s.source} className="source" data-status={s.status}>
            <header className="source-head">
              <h3>{c.label}</h3>
              <span className={`status status-${s.status}`}>{t(`st_${s.status}` as never)}</span>
            </header>
            <p className="small">
              {c.network} · chain {c.chainId} ·{' '}
              <a href={`${c.explorer}/address/${c.address}`} target="_blank" rel="noopener noreferrer">
                {c.address.slice(0, 8)}…{c.address.slice(-6)}
              </a>
            </p>
            <p className="small muted">
              <a href={c.provenance} target="_blank" rel="noopener noreferrer">
                {t('deployed', { b: c.startBlock.toLocaleString('en') })}
              </a>{' '}
              · {t('confirmations', { n: c.confirmations })}
            </p>
            {s.error && <p className="small warn">{s.error}</p>}
            {live || stale ? (
              <dl className={`facts${stale ? ' is-stale' : ''}`}>
                <div>
                  <dt>{t('head')}</dt>
                  <dd className="num">{s.head?.toLocaleString('en') ?? '-'}</dd>
                </div>
                <div>
                  <dt>{t('safeBlock')}</dt>
                  <dd className="num">{s.safe?.toLocaleString('en') ?? '-'}</dd>
                </div>
                {s.source === 'squeek' && s.wheel && (
                  <>
                    <div>
                      <dt>{t('wheelRound')}</dt>
                      <dd className="num">{s.wheel.settledThroughRound}</dd>
                    </div>
                    <div>
                      <dt>{t('wheelBlocks')}</dt>
                      <dd className="num">{s.wheel.derivedBlocks}</dd>
                    </div>
                    <div>
                      <dt>{t('wheelHeight')}</dt>
                      <dd className="num">{s.wheel.blockHeight}</dd>
                    </div>
                    <div>
                      <dt>{t('wheelPaused')}</dt>
                      <dd>{s.wheel.paused ? t('yes') : t('no')}</dd>
                    </div>
                  </>
                )}
                <div>
                  <dt>{t('lastChecked', { t: '' }).trim()}</dt>
                  <dd className="num">{fmtTime(s.lastOkAt, lang)}</dd>
                </div>
              </dl>
            ) : (
              enabled && s.status !== 'paused' && <p className="small muted">{t('unavailableData')}</p>
            )}
            <h4>{t('recent')}</h4>
            {s.history.length === 0 ? (
              <p className="small muted">{t('none')}</p>
            ) : (
              <ul className="events">
                {s.history.map((e) => (
                  <li key={`${e.transactionHash}-${e.logIndex}`} className={e.status === 'removed' ? 'removed' : ''}>
                    <span>{e.type === 'request' ? 'Requested' : `BatchSettled #${e.round}`}</span>
                    <span className="num small">#{e.blockNumber.toLocaleString('en')}</span>
                    {e.status === 'removed' && <span className="small warn">{t('removed')}</span>}
                    <a href={txURL(c, e.transactionHash) ?? '#'} target="_blank" rel="noopener noreferrer" className="small">
                      {e.transactionHash.slice(0, 10)}…
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </article>
        );
      })}
      {!enabled && <p className="muted">{t('chainOff')}</p>}
      <h3>{t('rehearse')}</h3>
      <div className="row">
        <button className="btn" onClick={() => rehearse('request')}>
          {t('rehearseReq')}
        </button>
        <button className="btn" onClick={() => rehearse('settlement')}>
          {t('rehearseSet')}
        </button>
      </div>
    </div>
  );
}
