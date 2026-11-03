import { IMPLEMENTATION_SLOT, POLICY, type SourceConfig } from './config';
import { codeHash, decodeLog, decodeWheel, identity, STATE_CALL, TOPICS, type ChainEvent, type RawLog, type Wheel } from './protocol';

const READ_METHODS = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getLogs', 'eth_getCode', 'eth_getStorageAt', 'eth_call']);
const hex = (n: number) => '0x' + n.toString(16);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** Public JSON-RPC client: read-only methods, timeout, endpoint rotation, credentials omitted. */
export class PublicRPC {
  private endpoint = 0;
  private controllers = new Set<AbortController>();
  constructor(private urls: string[], private fetcher: Fetcher = (u, i) => fetch(u, i)) {}
  abort() {
    for (const c of this.controllers) c.abort();
    this.controllers.clear();
  }
  async call<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    if (!READ_METHODS.has(method)) throw new Error('Read-only RPC method required');
    const ctl = new AbortController();
    this.controllers.add(ctl);
    const timer = setTimeout(() => ctl.abort(), POLICY.timeoutMs);
    try {
      const r = await this.fetcher(this.urls[this.endpoint], {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: ctl.signal,
      });
      if (!r.ok) throw new Error(`RPC HTTP ${r.status}`);
      const d = await r.json();
      if (d.error || d.result === undefined || d.result === null) throw new Error('RPC could not serve this read');
      return d.result as T;
    } catch (e) {
      this.endpoint = (this.endpoint + 1) % this.urls.length;
      throw e;
    } finally {
      clearTimeout(timer);
      this.controllers.delete(ctl);
    }
  }
  current() {
    return this.urls[this.endpoint];
  }
}

export type Status = 'off' | 'connecting' | 'watching' | 'stale' | 'unavailable' | 'paused';

export interface Snapshot {
  source: SourceConfig['key'];
  status: Status;
  error: string;
  head: number | null;
  safe: number | null;
  lastOkAt: number | null;
  wheel: Wheel | null;
  history: ChainEvent[];
}

interface Point {
  number: number;
  hash: string;
  units: string | null;
}

export interface RPCLike {
  call<T = unknown>(method: string, params?: unknown[]): Promise<T>;
  abort(): void;
}

/**
 * Polls one source. Only blocks at least `confirmations` deep are read. Each log has a canonical
 * identity (chain, transaction, log index) and is played at most once per page session even if a
 * reorg removes and re-includes it. Failures back off exponentially and leave data visibly stale.
 */
export class ChainMonitor {
  status: Status = 'off';
  error = '';
  head: number | null = null;
  safe: number | null = null;
  lastOkAt: number | null = null;
  wheel: Wheel | null = null;
  history: ChainEvent[] = [];
  private seen: string[] = [];
  private cursor: Point | null = null;
  private checkpoints: Point[] = [];
  private failures = 0;
  private nextAt = 0;
  private busy = false;
  private polls = 0;
  private verified = false;

  constructor(
    readonly config: SourceConfig,
    private rpc: RPCLike,
    private hooks: { onEvents(e: ChainEvent[]): void; onRemoved(e: ChainEvent[]): void; onChange(): void },
    private clock: () => number = Date.now,
  ) {}

  snapshot(): Snapshot {
    const now = this.clock();
    let status = this.status;
    if (status === 'watching' && this.lastOkAt !== null && now - this.lastOkAt > POLICY.staleAfterMs) status = 'stale';
    return { source: this.config.key, status, error: this.error, head: this.head, safe: this.safe, lastOkAt: this.lastOkAt, wheel: this.wheel, history: this.history };
  }

  start() {
    if (this.status === 'off') this.status = 'connecting';
    this.nextAt = 0;
    this.hooks.onChange();
  }
  stop() {
    this.rpc.abort();
    this.status = 'off';
    this.hooks.onChange();
  }
  pause() {
    if (this.status === 'off') return;
    this.rpc.abort();
    this.status = 'paused';
    this.hooks.onChange();
  }
  resume() {
    if (this.status === 'paused') {
      this.status = this.lastOkAt ? 'watching' : 'connecting';
      this.nextAt = 0;
      this.hooks.onChange();
    }
  }
  due() {
    return this.status !== 'off' && this.status !== 'paused' && !this.busy && this.clock() >= this.nextAt;
  }

  private async block(n: number) {
    const b = await this.rpc.call<{ number: string; hash: string }>('eth_getBlockByNumber', [hex(n), false]);
    if (Number(BigInt(b.number)) !== n || !/^0x[\da-f]{64}$/i.test(b.hash)) throw new Error('Invalid canonical block');
    return b;
  }

  private async verify(n: number) {
    const c = this.config;
    const chain = Number(BigInt(await this.rpc.call<string>('eth_chainId')));
    if (chain !== c.chainId) throw new Error('RPC chain mismatch');
    const code = await this.rpc.call<`0x${string}`>('eth_getCode', [c.address, hex(n)]);
    if (code === '0x') throw new Error('Contract has no code');
    if (c.proxy) {
      const slot = await this.rpc.call<string>('eth_getStorageAt', [c.address, IMPLEMENTATION_SLOT, hex(n)]);
      if (!same('0x' + slot.slice(-40), c.implementation!)) throw new Error('Contract upgraded: re-verification required');
      const impl = await this.rpc.call<`0x${string}`>('eth_getCode', [c.implementation, hex(n)]);
      if (!same(codeHash(impl), c.runtimeHash)) throw new Error('Implementation code mismatch');
    } else if (!same(codeHash(code), c.runtimeHash)) throw new Error('Contract code mismatch');
  }

  private async point(n: number): Promise<Point> {
    const b = await this.block(n);
    let units: string | null = null;
    if (this.config.key === 'squeek') {
      const w = decodeWheel(await this.rpc.call<`0x${string}`>('eth_call', [{ to: this.config.address, data: STATE_CALL }, hex(n)]));
      this.wheel = w;
      units = w.cumulativeBlockUnits;
    }
    return { number: n, hash: b.hash.toLowerCase(), units };
  }

  private async reconcile(): Promise<void> {
    const cur = this.cursor!;
    const b = await this.block(cur.number);
    if (same(b.hash, cur.hash)) return;
    let match: Point | null = null;
    for (const p of [...this.checkpoints].reverse()) {
      if (p.number >= cur.number) continue;
      if (same((await this.block(p.number)).hash, p.hash)) {
        match = p;
        break;
      }
    }
    const removed = this.history.filter((e) => e.status !== 'removed' && (!match || e.blockNumber > match.number));
    for (const e of removed) e.status = 'removed';
    this.cursor = match;
    this.checkpoints = match ? this.checkpoints.filter((p) => p.number <= match!.number) : [];
    if (removed.length) this.hooks.onRemoved(removed);
  }

  async poll(force = false): Promise<void> {
    if (this.busy || this.status === 'off' || this.status === 'paused') return;
    if (!force && this.clock() < this.nextAt) return;
    this.busy = true;
    try {
      const head = Number(BigInt(await this.rpc.call<string>('eth_blockNumber')));
      const safe = head - this.config.confirmations;
      if (safe < this.config.startBlock) throw new Error('Deployment not yet confirmed');
      if (!this.verified || this.polls % POLICY.verifyEvery === 0) {
        await this.verify(safe);
        this.verified = true;
      }
      this.polls++;
      this.head = head;
      this.safe = safe;
      if (this.cursor) await this.reconcile();
      if (!this.cursor || safe - this.cursor.number > POLICY.maxCatchup) {
        // Baseline at the confirmed head: history is never replayed as new celebrations.
        this.cursor = await this.point(safe);
        this.checkpoints = [this.cursor];
      } else if (safe > this.cursor.number) {
        const from = this.cursor.number + 1;
        const to = Math.min(safe, this.cursor.number + POLICY.maxRange);
        const logs = await this.rpc.call<RawLog[]>('eth_getLogs', [
          { address: this.config.address, topics: [TOPICS[this.config.key]], fromBlock: hex(from), toBlock: hex(to) },
        ]);
        const end = await this.point(to);
        const fresh: ChainEvent[] = [];
        let prevUnits = this.cursor.units;
        for (const log of logs.sort((a, b) => Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)) || Number(BigInt(a.logIndex) - BigInt(b.logIndex)))) {
          if (log.removed) continue;
          const n = Number(BigInt(log.blockNumber));
          if (n < from || n > to) continue;
          let e: ChainEvent;
          try {
            e = decodeLog(this.config, this.config.chainId, log, this.clock());
          } catch {
            continue; // not our event: never shown, never celebrated
          }
          if (e.units && prevUnits !== null) {
            const delta = BigInt(e.units) / 1_000_000_000n - BigInt(prevUnits) / 1_000_000_000n;
            e.derivedBlocksDelta = delta >= 0n ? delta.toString() : undefined;
          }
          if (e.units) prevUnits = e.units;
          const id = identity(e);
          if (this.seen.includes(id)) {
            const old = this.history.find((h) => identity(h) === id);
            if (old) Object.assign(old, { status: 'confirmed', blockHash: e.blockHash, blockNumber: e.blockNumber });
            continue;
          }
          this.seen = [...this.seen, id].slice(-POLICY.seen);
          fresh.push(e);
        }
        this.cursor = end;
        this.checkpoints = [...this.checkpoints, end].slice(-POLICY.checkpoints);
        this.history = [...fresh.reverse(), ...this.history].slice(0, POLICY.history);
        if (fresh.length) this.hooks.onEvents(fresh.slice(0, POLICY.queue));
      }
      this.failures = 0;
      this.error = '';
      this.status = 'watching';
      this.lastOkAt = this.clock();
      this.nextAt = this.clock() + POLICY.pollMs;
    } catch (e) {
      this.failures++;
      this.error = (e as Error).message || 'RPC error';
      if (this.status !== 'off' && this.status !== 'paused') this.status = this.lastOkAt ? 'stale' : 'unavailable';
      if (/mismatch|upgraded|no code/.test(this.error)) this.verified = false;
      this.nextAt = this.clock() + Math.min(POLICY.maxBackoffMs, POLICY.pollMs * 2 ** this.failures);
    } finally {
      this.busy = false;
      this.hooks.onChange();
    }
  }
}
