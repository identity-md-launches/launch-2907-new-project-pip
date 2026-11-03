import { describe, expect, it } from 'vitest';
import { ChatClient, type ChatState, type WorkerLike } from '../src/chat/client';

// Lifecycle tests use a scripted mock worker. They prove state handling only, not real inference.
class MockWorker implements WorkerLike {
  sent: any[] = [];
  terminated = false;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent | Event) => void) | null = null;
  postMessage(m: unknown) {
    this.sent.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

function setup() {
  const workers: MockWorker[] = [];
  let state: ChatState | null = null;
  const c = new ChatClient(
    () => {
      const w = new MockWorker();
      workers.push(w);
      return w;
    },
    (s) => (state = s),
    () => ({ lang: 'en', stage: 'baby', bond: 10, energy: 80, fullness: 40, asleep: false }),
  );
  return { c, workers, state: () => state! };
}

describe('ChatClient lifecycle', () => {
  it('loads with progress, streams and finishes', () => {
    const { c, workers, state } = setup();
    c.start('webgpu');
    expect(state().phase).toBe('loading');
    workers[0].emit({ type: 'progress', progress: 0.5 });
    expect(state().progress).toBe(0.5);
    workers[0].emit({ type: 'ready', backend: 'webgpu' });
    expect(c.send('  hello   Pip ')).toBe(true);
    const gen = workers[0].sent.at(-1);
    expect(gen.type).toBe('generate');
    expect(JSON.stringify(gen.messages)).toContain('hello Pip');
    workers[0].emit({ type: 'token', id: gen.id, text: 'Squeak' });
    workers[0].emit({ type: 'token', id: gen.id, text: '!' });
    expect(state().lines.at(-1)!.text).toBe('Squeak!');
    workers[0].emit({ type: 'done', id: gen.id });
    expect(state().phase).toBe('ready');
    expect(state().lines.at(-1)!.status).toBe('done');
  });
  it('Stop ignores late tokens; Clear empties; Retry resends', () => {
    const { c, workers, state } = setup();
    c.start('webgpu');
    workers[0].emit({ type: 'ready' });
    c.send('one');
    const id = workers[0].sent.at(-1).id;
    c.stop();
    workers[0].emit({ type: 'token', id, text: 'late' });
    expect(state().lines.at(-1)!.text).toBe('');
    expect(state().lines.at(-1)!.status).toBe('stopped');
    c.retry();
    expect(workers[0].sent.at(-1).type).toBe('generate');
    expect(workers[0].sent.at(-1).id).not.toBe(id);
    c.clear();
    expect(state().lines).toEqual([]);
  });
  it('isolates a replaced worker and supports the explicit WASM retry', () => {
    const { c, workers, state } = setup();
    c.start('webgpu');
    workers[0].emit({ type: 'error', message: 'no-webgpu' });
    expect(state().phase).toBe('error');
    c.start('wasm');
    expect(workers[0].terminated).toBe(true);
    workers[0].emit({ type: 'ready', backend: 'webgpu' }); // late message from the old worker
    expect(state().phase).toBe('loading');
    workers[1].emit({ type: 'ready', backend: 'wasm' });
    expect(state()).toMatchObject({ phase: 'ready', backend: 'wasm' });
  });
  it('cancel during download ignores anything later', () => {
    const { c, workers, state } = setup();
    c.start('wasm');
    c.cancel();
    workers[0].emit({ type: 'ready' });
    expect(state().phase).toBe('idle');
    expect(c.send('hi')).toBe(false);
  });
  it('refuses empty input and input while generating', () => {
    const { c, workers } = setup();
    c.start('webgpu');
    workers[0].emit({ type: 'ready' });
    expect(c.send('   ')).toBe(false);
    expect(c.send('a')).toBe(true);
    expect(c.send('b')).toBe(false);
  });
});
