import { createRpc } from '@lightprotocol/stateless.js'

export interface ZKConnectionConfig {
  rpcUrl?: string
  compressRpcEndpoint?: string
  proverEndpoint?: string
  commitment?: 'processed' | 'confirmed' | 'finalized'
}

const DEVNET_RPC_ENDPOINT =
  "https://mainnet.helius-rpc.com/?api-key=f30d6a96-5fa2-4318-b2da-0f6d1deb5c83";
const DEVNET_COMPRESS_RPC_ENDPOINT =
  "https://mainnet.helius-rpc.com/?api-key=f30d6a96-5fa2-4318-b2da-0f6d1deb5c83";
const DEVNET_PROVER_ENDPOINT =
  "https://mainnet.helius-rpc.com/?api-key=f30d6a96-5fa2-4318-b2da-0f6d1deb5c83";



const zkConfig = {
  rpcUrl: DEVNET_RPC_ENDPOINT,
  compressRpcEndpoint: DEVNET_COMPRESS_RPC_ENDPOINT,
  proverEndpoint: DEVNET_PROVER_ENDPOINT,
  commitment: "confirmed" as const,
};

export function createZKConnection(config: ZKConnectionConfig = zkConfig) {
  const {
    rpcUrl,
    compressRpcEndpoint,
    proverEndpoint,
    commitment = 'confirmed',
  } = config

  return createRpc(rpcUrl, compressRpcEndpoint, proverEndpoint, {
    commitment,
  })
}

// Helper to create a ZK connection with custom indexer
export function createZKConnectionWithIndexer(config: ZKConnectionConfig = {}) {
  return createZKConnection(config)
}
