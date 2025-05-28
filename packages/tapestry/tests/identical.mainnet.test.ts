import { createRpc, merkletreePubkey } from "@lightprotocol/stateless.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { describe, expect, it } from "bun:test";
import fs from "fs";
import {
  EdgeService,
  getUmi,
  NodeService,
  OnChainOptions,
  TransactionTrackingService,
} from "/Users/davidmackay/dev/tapestry/packages/protocol-blockchain/src";
import {
  MintEdgePayload,
  MintNodePayload,
} from "/Users/davidmackay/dev/tapestry/packages/protocol-types/src";

// -----------------------------------------------------------------------------
// Test configuration
const LOCAL_RPC_ENDPOINT =
  "https://mainnet.helius-rpc.com/?api-key=f30d6a96-5fa2-4318-b2da-0f6d1deb5c83";
const LOCAL_COMPRESS_RPC_ENDPOINT =
  "https://mainnet.helius-rpc.com/?api-key=f30d6a96-5fa2-4318-b2da-0f6d1deb5c83";
const LOCAL_PROVER_ENDPOINT =
  "https://mainnet.helius-rpc.com/?api-key=f30d6a96-5fa2-4318-b2da-0f6d1deb5c83";

// Create mainnet connection
const localConnection = createRpc(
  LOCAL_RPC_ENDPOINT,
  LOCAL_COMPRESS_RPC_ENDPOINT,
  LOCAL_PROVER_ENDPOINT,
  {
    commitment: "confirmed",
  }
);

const zkConfig = {
  rpcUrl: LOCAL_RPC_ENDPOINT,
  compressRpcEndpoint: LOCAL_COMPRESS_RPC_ENDPOINT,
  proverEndpoint: LOCAL_PROVER_ENDPOINT,
  commitment: "confirmed" as const,
};
// -----------------------------------------------------------------------------

// Load the signer keypair used throughout the existing main-net tests so that we
// reuse the same funded account.  The path is relative to this test file.
const PAYER_KEYPAIR = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(
      fs.readFileSync("../../keys/signer_graphu_keypair.json", "utf-8")
    )
  )
);

// Minimal in-memory implementation of the TransactionTrackingService interface.
class InMemoryTracker implements TransactionTrackingService {
  private nextId = 1;
  async queueTransaction(): Promise<number> {
    return this.nextId++;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async updateTransactionStatus(): Promise<void> {
    /* no-op for the purpose of this test */
  }
}

// Helper to convert a PublicKey (from @solana/web3.js) to base58 string.
function pkToB58(pk: PublicKey): string {
  return pk.toBase58();
}

describe("edgeService – integration on local testnet", () => {
  // Single shared state between tests (we only run one test here).
  const umi = getUmi("mainnet");

  const tracker = new InMemoryTracker();
  const nodeService = new NodeService(umi, tracker);
  const edgeService = new EdgeService(umi, tracker);
  const merkleTree = new PublicKey(merkletreePubkey);

  const onChainOpts: OnChainOptions = { waitTransactionConfirmed: true };

  // it("sends 0.001 SOL using umi", async () => {
  //   console.log("umit address", umi.identity.publicKey);
  //   console.log(
  //     "umit balance",
  //     await umi.rpc.getBalance(umi.identity.publicKey)
  //   );
  // });

  it("mints two nodes and then an edge between them", async () => {
    // -----------------------------------------------------------------------
    // 1. Mint the first node
    // -----------------------------------------------------------------------
    const node1Payload: MintNodePayload = {
      id: `node-1-${Date.now()}`,
      merkleTree: merkleTree.toBase58(), // Not used by NodeService internally
      leafOwner: PAYER_KEYPAIR.publicKey.toBase58(),
      properties: [{ key: "label", value: "source" }],
    };

    let node1Res;
    try {
      node1Res = await nodeService.mintNode(node1Payload, onChainOpts);
      const sig1 = node1Res.transactionSignature;
      const sig1b58 = bs58.encode(Buffer.from(sig1 as any));
    } catch (e) {
      throw e;
    }
    const sourceNodeAddressB58 = pkToB58(
      node1Res.leafNode as unknown as PublicKey
    );

    // -----------------------------------------------------------------------
    // 2. Mint the second node
    // -----------------------------------------------------------------------
    const node2Payload: MintNodePayload = {
      id: `node-2-${Date.now()}`,
      merkleTree: merkleTree.toBase58(), // Not used
      leafOwner: PAYER_KEYPAIR.publicKey.toBase58(),
      properties: [{ key: "label", value: "target" }],
    };
    let node2Res;
    try {
      node2Res = await nodeService.mintNode(node2Payload, onChainOpts);
      const sig2 = node2Res.transactionSignature;
      const sig2b58 = bs58.encode(Buffer.from(sig2 as any));
    } catch (e) {
      throw e;
    }
    const targetNodeAddressB58 = pkToB58(
      node2Res.leafNode as unknown as PublicKey
    );

    // -----------------------------------------------------------------------
    // 3. Mint an edge between the two nodes using EdgeService
    // -----------------------------------------------------------------------
    // Wait a short time to ensure the indexer has caught up (optional, can be tuned)
    await new Promise((res) => setTimeout(res, 20000));

    console.log("Minting edge");
    const edgePayload: MintEdgePayload = {
      id: `edge-${Date.now()}`,
      merkleTree: merkleTree.toBase58(), // Not used inside EdgeService.mintEdgeOnChain
      leafOwner: PAYER_KEYPAIR.publicKey.toBase58(),
      properties: [
        { key: "timestamp", value: Date.now().toString() },
        { key: "weight", value: "1" },
      ],
      startId: sourceNodeAddressB58,
      endId: targetNodeAddressB58,
    };

    // The edgeService.mintEdge will internally call setupZKCompression with [startId, endId]
    const { transactionSignature } = await edgeService.mintEdge(
      edgePayload,
      onChainOpts
    );
    const edgeSigB58 = bs58.encode(Buffer.from(transactionSignature as any));
    expect(transactionSignature).toBeDefined();
  }, 30000);
});
