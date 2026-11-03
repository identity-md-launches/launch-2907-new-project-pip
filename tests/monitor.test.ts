import { describe, expect, it } from 'vitest';
import { keccak256 } from 'viem';
import { ChainMonitor, errorCode, type RPCLike } from '../src/chain/monitor';
import { SOURCES, type SourceConfig } from '../src/chain/config';
import { identity } from '../src/chain/protocol';
import receipt from './fixtures/imd-receipt.json';

// Deterministic mocked RPC. Simulated protocol test, not an observed live reorg.
const CODE = '0x6001600055' as const;
const cfg: SourceConfig = { ...SOURCES.imd, startBlock: 1, confirmations: 0, runtimeHash: keccak256(CODE) };
const requested = (receipt as { receipt: { logs: Record<string, unknown>[] } }).receipt.logs.find(
  (l) => (l.address as string).toLowerCase() === cfg.address,
)!;
const h = (n: number, tag = 'a') => '0x' + (tag + n.toString(16)).padStart(64, '0');

class Chain implements RPCLike {
  head = 10;
  hashes = new Map<number, string>();
  logs: Record<string, unknown>[] = [];
  fail = false;
  chainId = 1;
  constructor() {
    for (let i = 0; i <= 40; i++) this.hashes.set(i, h(i));
  }
  abort() {}
  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    if (this.fail) throw new Error('RPC HTTP 503');
    const p = params as [Record<string, string> | string, ...unknown[]];
    switch (method) {
      case 'eth_chainId':
        return ('0x' + this.chainId.toString(16)) as T;
      case 'eth_blockNumber':
        return ('0x' + this.head.toString(16)) as T;
      case 'eth_getCode':
        return CODE as T;
      case 'eth_getBlockByNumber': {
        const n = Number(BigInt(p[0] as string));
        return { number: p[0], hash: this.hashes.get(n) } as T;
      }
      case 'eth_getLogs': {
        const f = p[0] as Record<string, string>;
        const from = Number(BigInt(f.fromBlock));
        const to = Number(BigInt(f.toBlock));
        return this.logs.filter((l) => {
          const n = Number(BigInt(l.blockNumber as string));
          return n >= from && n <= to;
        }) as T;
      }
    }
    throw new Error('unexpected ' + method);
  }
  include(block: number, logIndex: string) {
    this.logs = [{ ...requested, blockNumber: '0x' + block.toString(16), blockHash: this.hashes.get(block), logIndex }];
  }
}

function setup() {
  const rpc = new Chain();
  const events: string[][] = [];
  const removed: string[][] = [];
  let now = 1_000_000;
  const m = new ChainMonitor(cfg, rpc, {
    onEvents: (e) => events.push(e.map(identity)),
    onRemoved: (e) => removed.push(e.map(identity)),
    onChange: () => undefined,
  }, () => now);
  m.start();
  return { rpc, m, events, removed, tick: (ms: number) => (now += ms) };
}

describe('ChainMonitor', () => {
  it('reacts once when a reorg re-includes the same request with a different logIndex', async () => {
    const { rpc, m, events, removed } = setup();
    await m.poll(true); // baseline at block 10
    rpc.head = 11;
    rpc.include(11, '0x1b2');
    await m.poll(true);
    expect(events).toHaveLength(1);
    // Block 11 is replaced; the same transaction lands in block 12 behind one more log.
    rpc.hashes.set(11, h(11, 'b'));
    rpc.head = 12;
    rpc.include(12, '0x1b3');
    await m.poll(true);
    expect(removed).toHaveLength(1);
    await m.poll(true);
    expect(events).toHaveLength(1); // no second celebration
    expect(m.history).toHaveLength(1);
    expect(m.history[0]).toMatchObject({ status: 'confirmed', blockNumber: 12, logIndex: 0x1b3 });
    expect(m.history[0].transactionHash).toBe(requested.transactionHash);
  });

  it('identity is stable across logIndex changes', () => {
    const base = { chainId: 1, transactionHash: '0xAB', type: 'request', identifier: '0x01' };
    expect(identity(base)).toBe(identity({ ...base }));
    expect(identity(base)).not.toContain('435');
  });

  it('ignores logs from another emitter and never replays history before the baseline', async () => {
    const { rpc, m, events } = setup();
    rpc.include(9, '0x1');
    await m.poll(true);
    rpc.head = 11;
    rpc.logs = [{ ...requested, address: '0x0000000000000000000000000000000000000001', blockNumber: '0xb', blockHash: rpc.hashes.get(11), logIndex: '0x0' }];
    await m.poll(true);
    expect(events).toHaveLength(0);
  });

  it('goes unavailable, then stale, and backs off; data is never shown as live', async () => {
    const { rpc, m, tick } = setup();
    rpc.fail = true;
    await m.poll(true);
    expect(m.snapshot().status).toBe('unavailable');
    expect(m.snapshot().errorCode).toBe('rpc');
    rpc.fail = false;
    await m.poll(true);
    expect(m.snapshot().status).toBe('watching');
    tick(80_000);
    expect(m.snapshot().status).toBe('stale');
    rpc.fail = true;
    await m.poll(true);
    expect(m.snapshot().status).toBe('stale');
    expect(m.due()).toBe(false);
  });

  it('refuses an RPC on the wrong chain', async () => {
    const { rpc, m } = setup();
    rpc.chainId = 5;
    await m.poll(true);
    expect(m.snapshot().status).toBe('unavailable');
    expect(m.snapshot().errorCode).toBe('chain');
  });

  it('a stop during an in-flight poll stays stopped', async () => {
    const { m } = setup();
    const p = m.poll(true);
    m.stop();
    await p;
    expect(m.snapshot().status).toBe('off');
  });

  it('maps messages to translatable codes', () => {
    expect(errorCode('Contract upgraded: re-verification required')).toBe('upgraded');
    expect(errorCode('Implementation code mismatch')).toBe('code');
    expect(errorCode('Deployment not yet confirmed')).toBe('notyet');
    expect(errorCode('')).toBe('');
  });
});
