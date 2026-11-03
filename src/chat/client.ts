import { buildMessages, MAX_INPUT, visibleReply, type Backend, type ChatMsg, type PipContext } from './model';

export interface WorkerLike {
  postMessage(m: unknown): void;
  terminate(): void;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: ErrorEvent | Event) => void) | null;
}

export interface Line {
  id: number;
  role: 'user' | 'assistant';
  raw: string;
  text: string;
  status: 'streaming' | 'done' | 'stopped' | 'error';
}

export interface ChatState {
  phase: 'idle' | 'loading' | 'ready' | 'generating' | 'error';
  backend: Backend | null;
  progress: number;
  lines: Line[];
  error: string;
}

/**
 * Chat lifecycle: load (GPU, or an explicit WASM compatibility retry), stream, Stop, Clear, Retry.
 * Every reply carries a generation id; tokens from a stopped/cleared generation or from a
 * replaced worker are ignored, so a late response can never land in the wrong conversation.
 */
export class ChatClient {
  state: ChatState = { phase: 'idle', backend: null, progress: 0, lines: [], error: '' };
  private worker: WorkerLike | null = null;
  private activeId: number | null = null;
  private nextId = 1;
  private lastPrompt: string | null = null;
  private loadFailed = false;

  constructor(private factory: () => WorkerLike, private onChange: (s: ChatState) => void, private context: () => PipContext) {}

  private set(p: Partial<ChatState>) {
    this.state = { ...this.state, ...p };
    this.onChange(this.state);
  }

  start(backend: Backend) {
    this.worker?.terminate();
    const w = this.factory();
    this.worker = w;
    this.activeId = null;
    w.onmessage = (e) => {
      if (w !== this.worker) return; // late message from a replaced worker
      this.handle(e.data);
    };
    w.onerror = () => {
      if (w !== this.worker) return;
      this.set({ phase: 'error', error: 'worker-crashed' });
    };
    this.loadFailed = false;
    this.set({ phase: 'loading', backend, progress: 0, error: '' });
    w.postMessage({ type: 'load', backend });
  }

  private handle(m: { type: string; id?: number; text?: string; progress?: number; message?: string; backend?: Backend }) {
    if (m.type === 'progress') {
      if (this.state.phase === 'loading') this.set({ progress: Math.max(0, Math.min(1, m.progress ?? 0)) });
      return;
    }
    if (m.type === 'ready') return this.set({ phase: 'ready', progress: 1, backend: m.backend ?? this.state.backend });
    if (m.type === 'error' && m.id === undefined) {
      this.loadFailed = true;
      return this.set({ phase: 'error', error: m.message || 'load-failed' });
    }
    if (m.id === undefined || m.id !== this.activeId) return; // stale generation
    const lines = this.state.lines.map((l) => {
      if (l.id !== m.id || l.role !== 'assistant') return l;
      if (m.type === 'token') {
        const raw = l.raw + (m.text ?? '');
        return { ...l, raw, text: visibleReply(raw) };
      }
      if (m.type === 'done') return { ...l, status: 'done' as const };
      if (m.type === 'error') return { ...l, status: 'error' as const };
      return l;
    });
    if (m.type === 'token') return this.set({ lines });
    this.activeId = null;
    this.set({ lines, phase: m.type === 'error' ? 'error' : 'ready', error: m.type === 'error' ? m.message || 'generation-failed' : '' });
  }

  send(text: string): boolean {
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, MAX_INPUT);
    if (!clean || this.state.phase !== 'ready' || !this.worker) return false;
    const id = this.nextId++;
    this.activeId = id;
    this.lastPrompt = clean;
    const history: ChatMsg[] = this.state.lines
      .filter((l) => l.status !== 'error' && l.text)
      .map((l) => ({ role: l.role, content: l.text }));
    history.push({ role: 'user', content: clean });
    const lines: Line[] = [
      ...this.state.lines,
      { id, role: 'user', raw: clean, text: clean, status: 'done' },
      { id, role: 'assistant', raw: '', text: '', status: 'streaming' },
    ];
    this.set({ lines, phase: 'generating' });
    this.worker.postMessage({ type: 'generate', id, messages: buildMessages(history, this.context()) });
    return true;
  }

  stop() {
    if (this.activeId === null) return;
    const id = this.activeId;
    this.activeId = null;
    this.worker?.postMessage({ type: 'stop' });
    this.set({
      phase: 'ready',
      lines: this.state.lines.map((l) => (l.id === id && l.role === 'assistant' ? { ...l, status: 'stopped' } : l)),
    });
  }

  clear() {
    if (this.activeId !== null) this.worker?.postMessage({ type: 'stop' });
    this.activeId = null;
    this.set({ lines: [], phase: this.worker && this.state.phase !== 'loading' && this.state.phase !== 'error' ? 'ready' : this.state.phase });
  }

  /** Retry: after a load failure reload the same backend; after a failed reply resend the last prompt. */
  retry() {
    if (!this.worker || this.loadFailed || this.state.error === 'worker-crashed') return this.start(this.state.backend ?? 'webgpu');
    if (this.state.phase === 'loading' || this.state.phase === 'generating') return;
    const prompt = this.lastPrompt;
    if (!prompt) return;
    const lines = this.state.lines;
    const lastUser = [...lines].reverse().find((l) => l.role === 'user');
    this.state = { ...this.state, phase: 'ready', lines: lastUser ? lines.filter((l) => l.id !== lastUser.id) : lines };
    this.send(prompt);
  }

  /** Cancels a model download/initialisation; anything the old worker sends later is ignored. */
  cancel() {
    this.worker?.terminate();
    this.worker = null;
    this.activeId = null;
    this.set({ phase: 'idle', progress: 0, error: '' });
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.activeId = null;
  }
}
