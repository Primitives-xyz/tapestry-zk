import {
  createAccount,
  createRpc,
  defaultTestStateTreeAccounts,
  deriveAddress,
  deriveAddressSeed,
  LightSystemProgram,
  Rpc,
} from "@lightprotocol/stateless.js";
import { randomBytes } from "crypto";
import { PublicKey } from "@solana/web3.js";
import { NAME_KEYPAIR, connection as rpc } from "./common";

const fromKeypair = NAME_KEYPAIR;

async function createAccountTest() {
  const seeds = [new Uint8Array(randomBytes(32))];
  const seed = deriveAddressSeed(seeds, LightSystemProgram.programId);
  const addressTree = defaultTestStateTreeAccounts().addressTree;
  const address = deriveAddress(seed, addressTree);

  await createAccount(
    rpc,
    fromKeypair,
    seeds,
    LightSystemProgram.programId,
    undefined,
    undefined,
    defaultTestStateTreeAccounts().merkleTree
  );

  // fetch the owners latest account
  const accounts = await rpc.getCompressedAccountsByOwner(
    fromKeypair.publicKey
  );
  const latestAccount = accounts.items[0];

  // assert the address was indexed
  console.log(
    "Address check:",
    new PublicKey(latestAccount.address!).equals(address)
  );

  const signaturesUnspent = await rpc.getCompressionSignaturesForAddress(
    new PublicKey(latestAccount.address!)
  );

  /// most recent therefore unspent account
  console.log(
    "Signatures unspent count:",
    signaturesUnspent.items.length,
    "expected: 1"
  );
}

createAccountTest();
