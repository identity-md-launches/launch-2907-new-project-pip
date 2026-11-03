import type { Key } from '../i18n';

export type T = (key: Key, vars?: Record<string, string | number>) => string;

export interface FloatCard {
  id: string;
  kind: 'live' | 'simulated' | 'local';
  title: string;
  why: string;
  chain?: string; // e.g. "Ethereum mainnet · chain 1"
  confirm?: string;
  tx?: string; // explorer URL
  txHash?: string;
  at: number;
}
