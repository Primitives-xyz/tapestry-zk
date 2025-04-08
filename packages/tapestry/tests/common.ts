import * as anchor from "@coral-xyz/anchor";

import { createRpc } from "@lightprotocol/stateless.js";
import fs from "fs";

// Load keypairs from files
export const PAYER_KEYPAIR = anchor.web3.Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(fs.readFileSync("../../keys/test/payer.json", "utf-8"))
  )
);

export const NAME_KEYPAIR = anchor.web3.Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(fs.readFileSync("../../keys/provider-wallet.json", "utf-8"))
  )
);

// Define RPC endpoint
export const RPC_ENDPOINT = "http://127.0.0.1:8899";
export const COMPRESS_RPC_ENDPOINT = "http://127.0.0.1:8784";
export const PROVER_ENDPOINT = "http://127.0.0.1:3001";
export const CUSTOM_COMPRESS_RPC_ENDPOINT = "http://127.0.0.1:8784";
// Create connection
export const connection = createRpc(
  RPC_ENDPOINT,
  COMPRESS_RPC_ENDPOINT,
  PROVER_ENDPOINT,
  {
    commitment: "confirmed",
  }
);

export const connectionWithCustomIndexer = createRpc(
  RPC_ENDPOINT,
  CUSTOM_COMPRESS_RPC_ENDPOINT,
  PROVER_ENDPOINT,
  { commitment: "confirmed" }
);
