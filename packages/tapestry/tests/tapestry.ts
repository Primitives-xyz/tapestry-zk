import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Tapestry } from "../target/types/tapestry";
import {
  LightSystemProgram,
  NewAddressParams,
  bn,
  buildAndSignTx,
  createAccount,
  defaultStaticAccountsStruct,
  defaultTestStateTreeAccounts,
  deriveAddress,
  packCompressedAccounts,
  packNewAddressParams,
  sendAndConfirmTx,
  deriveAddressSeed,
} from "@lightprotocol/stateless.js";
//@ts-expect-error
import { describe, it } from "bun:test";
import { Keypair } from "@solana/web3.js";
import idl from "../target/idl/tapestry.json";
import * as borsh from "borsh";

import "dotenv/config";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import { nodeSchemaV1 } from "../src";

import { connection as rpc, PAYER_KEYPAIR, NAME_KEYPAIR } from "./common";

const { PublicKey } = anchor.web3;

// Using PAYER_KEYPAIR from common.ts instead of loading it again
const keypairOther = PAYER_KEYPAIR;

const setComputeUnitLimitIx =
  anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({
    units: 900_000,
  });
const setComputeUnitPriceIx =
  anchor.web3.ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 1,
  });

describe("tapestry", () => {
  // Configure the client to use the local cluster.
  const program = new Program<Tapestry>(
    idl as any,
    "GraphUyqhPmEAckWzi7zAvbvUTXf8kqX7JtuvdGYRDRh",
    new anchor.AnchorProvider(
      // new Connection(process.env.MAINNET_RPC as string, {
      //   commitment: "confirmed",
      // }),
      rpc,
      new anchor.Wallet(NAME_KEYPAIR),
      {
        commitment: "confirmed",
      }
    )
  );

  it("Can create compressed account", async () => {
    const seed = Keypair.generate().publicKey.toBytes();

    const txSig = await createAccount(
      rpc,
      NAME_KEYPAIR,
      [seed],
      program.programId,
      undefined,
      undefined,
      defaultTestStateTreeAccounts().merkleTree
    );
  });

  it("Can create node", async () => {
    const addressTree = defaultTestStateTreeAccounts().addressTree;
    const addressQueue = defaultTestStateTreeAccounts().addressQueue;
    const randomBytes = Keypair.generate().publicKey.toBytes();

    const accountKeyNode = Uint8Array.from([0]);

    const assetSeed = deriveAddressSeed(
      [accountKeyNode, randomBytes],
      program.programId
    );

    const assetAddress = deriveAddress(assetSeed, addressTree);

    // Get a fresh proof for the node address
    // Important: We need to make sure we're getting a proof for the latest state
    const proof = await rpc.getValidityProofV0(undefined, [
      {
        address: bn(assetAddress.toBytes()),
        tree: addressTree,
        queue: addressQueue,
      },
    ]);

    // Create the new address parameters
    // Important: Make sure the root index matches exactly
    const newAddressParams: NewAddressParams = {
      seed: assetSeed,
      addressMerkleTreeRootIndex: proof.rootIndices[0],
      addressMerkleTreePubkey: proof.merkleTrees[0],
      addressQueuePubkey: proof.nullifierQueues[0],
    };

    // Create the output compressed accounts
    const outputCompressedAccounts =
      LightSystemProgram.createNewAddressOutputState(
        Array.from(assetAddress.toBytes()),
        program.programId
      );

    const { remainingAccounts: _remainingAccounts } = packCompressedAccounts(
      [],
      [],
      outputCompressedAccounts,
      defaultTestStateTreeAccounts().merkleTree
    );
    const { newAddressParamsPacked, remainingAccounts } = packNewAddressParams(
      [newAddressParams],
      _remainingAccounts
    );

    // Create node arguments according to the IDL structure
    // Important: Make sure this matches exactly what the program expects
    const nodeArgs = {
      label: "test-node",
      properties: [
        {
          key: "description",
          value: "This is a test node",
        },
        {
          key: "type",
          value: "test",
        },
      ],
      isMutable: true,
      creators: [],
    };

    const {
      accountCompressionAuthority,
      noopProgram,
      registeredProgramPda,
      accountCompressionProgram,
    } = defaultStaticAccountsStruct();

    // Create the instruction with the correct parameters
    // Important: Make sure the root index matches exactly what's in the proof
    const ix = await program.methods
      .createNode(
        {
          a: proof.compressedProof.a,
          b: proof.compressedProof.b,
          c: proof.compressedProof.c,
        },
        newAddressParamsPacked[0].addressMerkleTreeRootIndex, // Use the exact root index from the proof
        Array.from(randomBytes),
        nodeArgs
      )
      .accounts({
        payer: NAME_KEYPAIR.publicKey,
        updateAuthority: NAME_KEYPAIR.publicKey,
        owner: keypairOther.publicKey,
        cpiAuthorityPda: PublicKey.findProgramAddressSync(
          [Buffer.from("cpi_authority")],
          program.programId
        )[0],
        selfProgram: program.programId,
        lightSystemProgram: LightSystemProgram.programId,
        accountCompressionAuthority,
        accountCompressionProgram,
        noopProgram,
        registeredProgramPda,
      })
      .remainingAccounts(
        remainingAccounts.map((account) => ({
          pubkey: account,
          isSigner: false,
          isWritable: true,
        }))
      )
      .instruction();

    const blockhash = await rpc.getLatestBlockhash();
    // Build and sign the transaction with both keypairs
    const tx = buildAndSignTx(
      [setComputeUnitLimitIx, setComputeUnitPriceIx, ix],
      NAME_KEYPAIR,
      blockhash.blockhash
    );

    const signature = await sendAndConfirmTx(rpc, tx, {
      commitment: "confirmed",
    });

    console.log("Your transaction signature", signature);
  }); // 30 second timeout just for this test

  it.skip("can fetch nodes by owner", async () => {
    // Add a delay to allow the transaction to be processed
    const nodes = await rpc.getCompressedAccountsByOwner(program.programId, {
      filters: [
        {
          memcmp: {
            bytes: bs58.encode([1]),
            offset: 0,
          },
        },
      ],
    });

    const newlyCreatedNode = nodes.items.find((node) => {
      try {
        // Try to deserialize as a node
        const decoded: any = borsh.deserialize(nodeSchemaV1, node.data.data);
        const owner = new PublicKey(Uint8Array.from(decoded.owner)).toBase58();

        const isFound = owner === keypairOther.publicKey.toBase58();

        return isFound;
      } catch (error) {
        console.error("Error decoding node:", error);
        return false;
      }
    });
  });
});
