import { useEffect, useRef, useState } from 'react';
import type { ChatClient, ChatState } from '../chat/client';
import { GPU, MAX_INPUT, WASM } from '../chat/model';
import type { T } from './types';

export function ChatPanel({ t, client, state, you }: { t: T; client: ChatClient; state: ChatState; you: string }) {
  const [text, setText] = useState('');
  const composing = useRef(false);
  const logRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    logRef.current?.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }, [state.lines]);

  const submit = () => {
    if (client.send(text)) setText('');
  };
  const errText = (e: string) => (e === 'no-webgpu' ? t('chatNoGpu') : t('chatError', { e }));

  return (
    <div className="chat">
      <h2>{t('chatTitle')}</h2>
      {state.phase === 'idle' && (
        <>
          <p className="muted">{t('chatIntro', { mb: GPU.downloadMB })}</p>
          <div className="row">
            <button className="btn btn-primary" onClick={() => client.start('webgpu')}>
              {t('chatStart')}
            </button>
            <button className="btn" onClick={() => client.start('wasm')}>
              {t('chatStartWasm')} ({WASM.downloadMB} MB)
            </button>
          </div>
        </>
      )}
      {state.phase === 'loading' && (
        <div className="row" role="status">
          <progress max={1} value={state.progress} aria-label={t('chatPreparing')} />
          <span className="num">{state.progress > 0 ? t('chatLoading', { p: Math.round(state.progress * 100) }) : t('chatPreparing')}</span>
          <button className="btn" onClick={() => client.cancel()}>
            {t('cancel')}
          </button>
        </div>
      )}
      {state.phase === 'error' && (
        <div className="notice" role="alert">
          <p>{errText(state.error)}</p>
          <div className="row">
            <button className="btn" onClick={() => client.retry()}>
              {t('retry')}
            </button>
            {state.backend !== 'wasm' && (
              <button className="btn" onClick={() => client.start('wasm')}>
                {t('chatStartWasm')}
              </button>
            )}
          </div>
        </div>
      )}
      {state.backend && state.phase !== 'idle' && <p className="muted small">{t('chatBackend', { b: state.backend === 'webgpu' ? 'WebGPU' : 'WASM' })}</p>}
      <ol className="chat-log" ref={logRef} aria-live="polite">
        {state.lines.map((l) => (
          <li key={`${l.id}-${l.role}`} className={`msg msg-${l.role}`}>
            <span className="who">{l.role === 'user' ? you : 'Pip'}</span>
            <span>
              {l.text || (l.status === 'streaming' ? '…' : '')}
              {l.status === 'stopped' && ` ${t('chatStopped')}`}
            </span>
          </li>
        ))}
      </ol>
      {(state.phase === 'ready' || state.phase === 'generating' || (state.phase === 'error' && state.lines.length > 0)) && (
        <form
          className="chat-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="sr-only" htmlFor="chat-input">
            {t('chatPlaceholder')}
          </label>
          <textarea
            id="chat-input"
            rows={2}
            maxLength={MAX_INPUT}
            value={text}
            placeholder={t('chatPlaceholder')}
            onChange={(e) => setText(e.target.value)}
            onCompositionStart={() => (composing.current = true)}
            onCompositionEnd={() => (composing.current = false)}
            onKeyDown={(e) => {
              // IME: Enter that confirms a composition must not send.
              if (e.key === 'Enter' && !e.shiftKey && !composing.current && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="row">
            {state.phase === 'generating' ? (
              <button type="button" className="btn" onClick={() => client.stop()}>
                {t('stop')}
              </button>
            ) : (
              <button type="submit" className="btn btn-primary" disabled={!text.trim() || state.phase !== 'ready'}>
                {t('send')}
              </button>
            )}
            <button type="button" className="btn" onClick={() => client.clear()} disabled={!state.lines.length}>
              {t('clear')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
