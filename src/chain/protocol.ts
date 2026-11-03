import { decodeEventLog, decodeFunctionResult, encodeFunctionData, keccak256, parseAbi, toEventSelector } from 'viem';
import type { SourceConfig } from './config';

const REQUESTED = parseAbi([
  'event Requested(bytes32 indexed requestId, address indexed payer, bytes32 indexed action, bytes body, address callbackTarget, bytes4 callbackSelector, address asset, uint256 amount)',
]);
const BATCH_SETTLED = parseAbi([
  'event BatchSettled(bytes32 indexed digest, address indexed reporter, uint64 indexed settledThroughRound, uint256 nonce, uint64 previousSettledThroughRound, uint16 activeRoundCount, uint64 cumulativeWork, uint96 cumulativeBlockUnits)',
]);
const STATE = parseAbi([
  'function state() view returns ((uint64 settledThroughRound,uint64 cumulativeWork,uint96 cumulativeBlockUnits,uint64 blockHeight,uint96 blockProgress,uint32 workPerThousandBlocks,uint256 authorizationNonce,bool paused))',
]);

export const TOPICS = { imd: toEventSelector(REQUESTED[0]), squeek: toEventSelector(BATCH_SETTLED[0]) };
export const STATE_CALL = encodeFunctionData({ abi: STATE, functionName: 'state' });
export const codeHash = (code: `0x${string}`) => keccak256(code);

export interface Wheel {
  settledThroughRound: string;
  cumulativeBlockUnits: string;
  derivedBlocks: string;
  blockHeight: string;
  paused: boolean;
}
export function decodeWheel(data: `0x${string}`): Wheel {
  const s = decodeFunctionResult({ abi: STATE, functionName: 'state', data }) as {
    settledThroughRound: bigint; cumulativeBlockUnits: bigint; blockHeight: bigint; paused: boolean;
  };
  return {
    settledThroughRound: s.settledThroughRound.toString(),
    cumulativeBlockUnits: s.cumulativeBlockUnits.toString(),
    derivedBlocks: (s.cumulativeBlockUnits / 1_000_000_000n).toString(),
    blockHeight: s.blockHeight.toString(),
    paused: s.paused,
  };
}

export interface RawLog {
  address: string;
  topics: `0x${string}`[];
  data: `0x${string}`;
  blockNumber: string;
  blockHash: string;
  transactionHash: string;
  transactionIndex: string;
  logIndex: string;
  removed?: boolean;
}

export interface ChainEvent {
  source: 'imd' | 'squeek';
  chainId: number;
  type: 'request' | 'settlement';
  blockNumber: number;
  blockHash: string;
  transactionHash: string;
  logIndex: number;
  identifier: string;
  action?: string;
  round?: string;
  previousRound?: string;
  units?: string;
  derivedBlocksDelta?: string;
  activeRounds?: string;
  status: 'confirmed' | 'removed';
  seenAt: number;
}

const H32 = /^0x[\da-f]{64}$/i;
/**
 * Replay identity: chain + transaction + the verified event identifier (requestId for a request,
 * settledThroughRound for a settlement). Unlike the block-global logIndex this does not change when a
 * reorg re-includes the same transaction behind a different number of earlier logs. Block hash and
 * logIndex are kept on the record separately to track the canonical occurrence.
 */
export const identity = (e: { chainId: number; transactionHash: string; type: string; identifier: string }) =>
  `${e.chainId}:${e.transactionHash.toLowerCase()}:${e.type}:${e.identifier.toLowerCase()}`;

/** Strict decode: wrong chain, wrong emitter, malformed provenance or a non-matching ABI throws. */
export function decodeLog(c: SourceConfig, chainId: number, log: RawLog, now: number): ChainEvent {
  if (chainId !== c.chainId || log.address.toLowerCase() !== c.address.toLowerCase()) throw new Error('Wrong chain or emitter');
  if (!H32.test(log.blockHash) || !H32.test(log.transactionHash)) throw new Error('Invalid provenance');
  const base = {
    source: c.key,
    chainId,
    blockNumber: Number(BigInt(log.blockNumber)),
    blockHash: log.blockHash.toLowerCase(),
    transactionHash: log.transactionHash.toLowerCase(),
    logIndex: Number(BigInt(log.logIndex)),
    status: 'confirmed' as const,
    seenAt: now,
  };
  if (c.key === 'imd') {
    const d = decodeEventLog({ abi: REQUESTED, topics: log.topics as never, data: log.data, strict: true });
    const a = d.args as { requestId: string; action: string };
    return { ...base, type: 'request', identifier: a.requestId, action: a.action };
  }
  const d = decodeEventLog({ abi: BATCH_SETTLED, topics: log.topics as never, data: log.data, strict: true });
  const a = d.args as { settledThroughRound: bigint; previousSettledThroughRound: bigint; cumulativeBlockUnits: bigint; activeRoundCount: number };
  return {
    ...base,
    type: 'settlement',
    identifier: a.settledThroughRound.toString(),
    round: a.settledThroughRound.toString(),
    previousRound: a.previousSettledThroughRound.toString(),
    units: a.cumulativeBlockUnits.toString(),
    activeRounds: String(a.activeRoundCount),
  };
}
