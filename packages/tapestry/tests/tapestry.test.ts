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
import { describe, it, expect } from "bun:test";
import { Keypair, PublicKey, SendTransactionError } from "@solana/web3.js";
import idl from "../target/idl/tapestry.json";
import * as borsh from "borsh";

import "dotenv/config";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import { nodeSchemaV1, PROGRAM_ID } from "../src";

import { connection as rpc, PAYER_KEYPAIR, NAME_KEYPAIR } from "./common";

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

// Define asset address at a higher scope
let assetAddress: PublicKey;

describe("tapestry", () => {
  // Configure the client to use the local cluster.
  const program = new Program<Tapestry>(
    idl as any,
    PROGRAM_ID,
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
    const merkleTree = defaultTestStateTreeAccounts().merkleTree;

    // Generate proper random bytes for node creation
    const randomBytes = anchor.web3.Keypair.generate().secretKey.slice(0, 32);
    const accountKeyNode = Uint8Array.from([0]);

    const assetSeed = deriveAddressSeed(
      [accountKeyNode, randomBytes],
      program.programId
    );

    assetAddress = deriveAddress(assetSeed, addressTree);

    // Get a fresh proof for the node address
    const proof = await rpc.getValidityProofV0(undefined, [
      {
        address: bn(assetAddress.toBytes()),
        tree: addressTree,
        queue: addressQueue,
      },
    ]);

    // Create the new address parameters
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
      merkleTree
    );
    const { newAddressParamsPacked, remainingAccounts } = packNewAddressParams(
      [newAddressParams],
      _remainingAccounts
    );

    // Create node arguments according to the IDL structure
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
    const ix = await program.methods
      .createNode(
        {
          a: proof.compressedProof.a,
          b: proof.compressedProof.b,
          c: proof.compressedProof.c,
        },
        newAddressParamsPacked[0].addressMerkleTreeRootIndex,
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

    const tx = buildAndSignTx(
      [setComputeUnitLimitIx, setComputeUnitPriceIx, ix],
      NAME_KEYPAIR,
      blockhash.blockhash
    );

    try {
      const signature = await sendAndConfirmTx(rpc, tx, {
        commitment: "confirmed",
      });
      console.log("Transaction signature:", signature);
      console.log("Asset Address:", assetAddress.toBase58());
      console.log("Owner:", keypairOther.publicKey.toBase58());
    } catch (error) {
      if (error instanceof SendTransactionError) {
        const logs = await error.getLogs(rpc);
        console.error("Transaction failed with logs:", logs);
      }
      throw Error(error);
    }
  });

  it("can fetch nodes by owner", async () => {
    // wait half a second
    await new Promise((resolve) => setTimeout(resolve, 500));
    const nodes = await rpc.getCompressedAccountsByOwner(program.programId, {
      filters: [
        {
          memcmp: {
            bytes: bs58.encode([1]),
            offset: 0,
          },
        },
        {
          memcmp: {
            bytes: keypairOther.publicKey.toBase58(),
            offset: 1,
          },
        },
      ],
    });

    const nodes2 = await rpc.getCompressedAccount(bn(assetAddress.toBytes()));
    console.log("Nodes2:", nodes2);

    // expect there to be at least one node
    expect(nodes.items.length).toBeGreaterThan(0);

    // You can now use assetAddress here
    console.log("Using asset address in fetch test:", assetAddress.toBase58());
  });
});
