// Read-only chain sources. Provenance: docs/chain/manifest.json and docs/chain/squeek-deployment.json
// (copied from the reference build's verified records, checked 2026-10-31).

export interface SourceConfig {
  key: 'imd' | 'squeek';
  chainId: number;
  network: string; // shown verbatim: never call a testnet "mainnet"
  label: string;
  address: `0x${string}`;
  startBlock: number;
  confirmations: number;
  explorer: string;
  provenance: string; // deployment transaction or deployment record URL
  rpc: string[];
  proxy: boolean;
  implementation?: `0x${string}`;
  runtimeHash: `0x${string}`;
}

export const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

export const SOURCES: Record<'imd' | 'squeek', SourceConfig> = {
  imd: {
    key: 'imd',
    chainId: 1,
    network: 'Ethereum mainnet',
    label: 'IMD Intake',
    address: '0xa43e6f75ee006411f79ac1c84120606c2330de82',
    startBlock: 26164897,
    confirmations: 3,
    explorer: 'https://etherscan.io',
    provenance: 'https://etherscan.io/tx/0x75acc7ce4cdddeff526a9a6aa40e5dbebfe8608e1e6576bcb6e4f640a6fc90db',
    rpc: ['https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.com'],
    proxy: false,
    runtimeHash: '0xdf76139e1b7dfe05bdf55e48e65076e4763a40d470fcf5da58034a488e30bdaf',
  },
  squeek: {
    key: 'squeek',
    chainId: 11155111,
    network: 'Sepolia testnet',
    label: 'Squeekchain SqueekCore',
    address: '0x74665daeca35a2303e767e76a2ff1fb6f93e119f',
    startBlock: 11902282,
    confirmations: 12,
    explorer: 'https://sepolia.etherscan.io',
    provenance: 'https://docs.squeekchain.com/assets/deployments/sepolia.json',
    rpc: ['https://ethereum-sepolia-rpc.publicnode.com', 'https://0xrpc.io/sep'],
    proxy: true,
    implementation: '0x0a71c86ab63a77675002a389fdf4d096a07b11e2',
    runtimeHash: '0xe8a5a5aa913141ddd8951cf9fcc1375044b541773e5b0bf8ee04a5c7ac2d194d',
  },
};

export const POLICY = {
  pollMs: 20_000,
  maxRange: 96,
  maxCatchup: 512,
  history: 12,
  seen: 256,
  checkpoints: 16,
  queue: 3,
  maxBackoffMs: 300_000,
  staleAfterMs: 75_000,
  verifyEvery: 15,
  timeoutMs: 10_000,
} as const;

export const txURL = (c: SourceConfig, hash: string) => (/^0x[\da-f]{64}$/i.test(hash) ? `${c.explorer}/tx/${hash}` : null);
