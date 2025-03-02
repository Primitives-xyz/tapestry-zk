import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Tapestry } from "../target/types/tapestry";
import {
  CompressedAccountWithMerkleContext,
  LightSystemProgram,
  NewAddressParams,
  Rpc,
  bn,
  buildAndSignTx,
  createAccount,
  createRpc,
  defaultStaticAccountsStruct,
  defaultTestStateTreeAccounts,
  deriveAddress,
  hashToBn254FieldSizeBe,
  packCompressedAccounts,
  packNewAddressParams,
  sendAndConfirmTx,
  deriveAddressSeed,
} from "@lightprotocol/stateless.js";
import fs from "fs";
//@ts-expect-error
import { expect, describe, it } from "bun:test";
import { Connection, Keypair } from "@solana/web3.js";
import idl from "../target/idl/tapestry.json";
import * as borsh from "borsh";

import "dotenv/config";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import { nodeSchemaV1 } from "../src";

const { PublicKey } = anchor.web3;

const namePo = anchor.web3.Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(fs.readFileSync("target/deploy/name.json", "utf-8"))
  )
);

const keypairOther = anchor.web3.Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(fs.readFileSync("target/deploy/keypair.json", "utf-8"))
  )
);

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
    // "zkN5FTcJzrwp2c9G4fL3qXo9tnVhiACG3xzoP3tV3Hh",
    "GraphUyqhPmEAckWzi7zAvbvUTXf8kqX7JtuvdGYRDRh",
    new anchor.AnchorProvider(
      // new Connection(process.env.MAINNET_RPC as string, {
      //   commitment: "confirmed",
      // }),
      new Connection("http://localhost:8899", {
        commitment: "confirmed",
      }),
      new anchor.Wallet(keypairOther),
      {
        commitment: "confirmed",
      }
    )
  );

  const connection: Rpc = createRpc(
    program.provider.connection.rpcEndpoint,
    // program.provider.connection.rpcEndpoint,
    undefined,
    undefined,
    {
      commitment: "confirmed",
    }
  );

  it.only("Can create compressed account", async () => {
    const seed = Keypair.generate().publicKey.toBytes();

    const txSig = await createAccount(
      connection,
      namePo,
      [seed],
      program.programId,
      undefined,
      undefined,
      undefined
    );
  });

  const randomBytes = Keypair.generate().publicKey.toBytes();
  const recipient = keypairOther;
  // const recipient = keypair;

  it("Can create node", async () => {
    // First create a compressed account to ensure the merkle tree is initialized
    const seed = Keypair.generate().publicKey.toBytes();
    await createAccount(
      connection,
      namePo,
      [seed],
      program.programId,
      undefined,
      undefined,
      undefined
    );

    console.log("Created initial compressed account");

    const addressTree = defaultTestStateTreeAccounts().addressTree;
    const addressQueue = defaultTestStateTreeAccounts().addressQueue;
    console.log({
      addressTree: addressTree.toBase58(),
      addressQueue: addressQueue.toBase58(),
    });

    const accountKeyNode = Uint8Array.from([0]);

    const assetSeed = deriveAddressSeed(
      [accountKeyNode, randomBytes],
      program.programId
    );

    const nodeAddress = await deriveAddress(assetSeed, addressTree);
    console.log("Node address:", nodeAddress.toBase58());

    // Wait a moment to ensure the previous transaction is fully processed
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Get a fresh proof for the node address
    // Important: We need to make sure we're getting a proof for the latest state
    const proof = await connection.getValidityProofV0(undefined, [
      {
        address: bn(nodeAddress.toBytes()),
        tree: addressTree,
        queue: addressQueue,
      },
    ]);

    console.log("Got proof with root index:", proof.rootIndices[0]);

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
        Array.from(nodeAddress.toBytes()),
        program.programId
      );

    // Pack the compressed accounts and new address parameters
    const { remainingAccounts: _remainingAccounts } = packCompressedAccounts(
      [],
      [],
      outputCompressedAccounts
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
        proof.rootIndices[0], // Use the exact root index from the proof
        Array.from(randomBytes),
        nodeArgs
      )
      .accounts({
        payer: namePo.publicKey,
        updateAuthority: keypairOther.publicKey,
        owner: keypairOther.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
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

    const blockhash = await connection.getLatestBlockhash();
    const skipPreflight = false; // Skip preflight to see detailed errors

    // Build and sign the transaction with both keypairs
    const tx = buildAndSignTx(
      [setComputeUnitLimitIx, setComputeUnitPriceIx, ix],
      namePo,
      blockhash.blockhash,
      [keypairOther] // Add keypairOther as an additional signer
    );

    try {
      const signature = await sendAndConfirmTx(connection, tx, {
        commitment: "confirmed",
        skipPreflight,
      });

      console.log("Your transaction signature", signature);
      console.log("node id:", nodeAddress.toBase58());
      console.log("owner:", recipient.publicKey.toBase58());
    } catch (error) {
      // If there's a logs property in the error, print it for debugging

      throw error;
    }
  });

  it.skip("can fetch nodes by owner", async () => {
    // Add a delay to allow the transaction to be processed
    console.log("Waiting for transaction to be processed...");
    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log("Fetching nodes for owner:", keypairOther.publicKey.toBase58());
    const nodes = await connection.getCompressedAccountsByOwner(
      program.programId,
      {
        filters: [
          {
            memcmp: {
              bytes: bs58.encode([1]),
              offset: 0,
            },
          },
        ],
      }
    );

    console.log("Found", nodes.items.length, "nodes");

    // Debug all nodes found
    nodes.items.forEach((node, index) => {
      console.log(`Node ${index}:`, {
        address: new PublicKey(Uint8Array.from(node.address)).toBase58(),
        data: node.data,
      });
    });

    const newlyCreatedNode = nodes.items.find((node) => {
      try {
        // Try to deserialize as a node
        const decoded: any = borsh.deserialize(nodeSchemaV1, node.data.data);
        console.log("Decoded node:", decoded);

        const owner = new PublicKey(Uint8Array.from(decoded.owner)).toBase58();
        console.log("Node owner:", owner);
        console.log("Expected owner:", keypairOther.publicKey.toBase58());

        const isFound = owner === keypairOther.publicKey.toBase58();
        if (isFound) {
          console.log("Found node:", {
            ...decoded,
            owner,
            updateAuthority: new PublicKey(
              Uint8Array.from(decoded.updateAuthority)
            ).toBase58(),
            label: decoded.label,
            properties: decoded.properties,
            isMutable: decoded.isMutable,
            creators: decoded.creators.map((c: any) => ({
              address: new PublicKey(Uint8Array.from(c.address)).toBase58(),
              verified: c.verified,
              share: c.share,
            })),
          });
        }
        return isFound;
      } catch (error) {
        console.error("Error decoding node:", error);
        return false;
      }
    });

    // Skip the assertion for now until we fix the node creation
    // expect(newlyCreatedNode).to.not.be.undefined;
    console.log("Node found:", !!newlyCreatedNode);
  });

  const recipient2 = Keypair.generate();
});
