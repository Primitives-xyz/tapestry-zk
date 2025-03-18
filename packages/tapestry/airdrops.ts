import { createRpc } from "@lightprotocol/stateless.js";
import * as anchor from "@coral-xyz/anchor";
import fs from "fs";
// Define RPC endpoint
export const RPC_ENDPOINT = "http://localhost:8899";
export const COMPRESS_RPC_ENDPOINT = "http://localhost:8784";
export const PROVER_ENDPOINT = "http://localhost:3001";
// Create connection
export const connection = createRpc(
  RPC_ENDPOINT,
  COMPRESS_RPC_ENDPOINT,
  PROVER_ENDPOINT,
  {
    commitment: "confirmed",
  }
);

async function airDrops() {
  const TEST_PAYER_KEYPAIR = anchor.web3.Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(fs.readFileSync("../../keys/test/payer.json", "utf-8"))
    )
  );

  const PROVIDER_KEYPAIR = anchor.web3.Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(fs.readFileSync("../../keys/provider-wallet.json", "utf-8"))
    )
  );

  const PROGRAM_KEYPAIR = anchor.web3.Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(fs.readFileSync("../../keys/GraphU.json", "utf-8"))
    )
  );
  await connection.requestAirdrop(TEST_PAYER_KEYPAIR.publicKey, 10);
  await connection.confirmTransaction({
    signature: await connection.requestAirdrop(TEST_PAYER_KEYPAIR.publicKey, 2),
    ...(await connection.getLatestBlockhash()),
  });

  await connection.requestAirdrop(PROVIDER_KEYPAIR.publicKey, 10);
  await connection.confirmTransaction({
    signature: await connection.requestAirdrop(PROVIDER_KEYPAIR.publicKey, 2),
    ...(await connection.getLatestBlockhash()),
  });

  await connection.requestAirdrop(PROGRAM_KEYPAIR.publicKey, 10);
  await connection.confirmTransaction({
    signature: await connection.requestAirdrop(PROGRAM_KEYPAIR.publicKey, 2),
    ...(await connection.getLatestBlockhash()),
  });
}

airDrops();
