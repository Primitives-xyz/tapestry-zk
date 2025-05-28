import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  addressQueue as aq,
  addressTree as aT,
  bn,
  buildAndSignTx,
  createAccount,
  createRpc,
  defaultStaticAccountsStruct,
  defaultTestStateTreeAccounts,
  deriveAddress,
  deriveAddressSeed,
  LightSystemProgram,
  merkletreePubkey,
  NewAddressParams,
  packCompressedAccounts,
  packNewAddressParams,
  sendAndConfirmTx,
} from "@lightprotocol/stateless.js";
import { Tapestry } from "../target/types/tapestry";
//@ts-expect-error
import { Keypair, PublicKey, SendTransactionError } from "@solana/web3.js";
import * as borsh from "borsh";
import { describe, expect, it } from "bun:test";
import fs from "fs";
import idl from "../target/idl/tapestry.json";

import "dotenv/config";
import {
  creatorSchema,
  PROGRAM_ID,
  propertiesSchema,
  rawNodeSchema as NodeSchemaV1,
} from "../src";

import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { setupZKCompression } from "./zkCompression";
import { createZKConnection } from "./zkConnection";

// Define mainnet RPC endpoint
const DEVNET_RPC_ENDPOINT =
  "https://mainnet.helius-rpc.com/?api-key=f30d6a96-5fa2-4318-b2da-0f6d1deb5c83";
const DEVNET_COMPRESS_RPC_ENDPOINT =
  "https://mainnet.helius-rpc.com/?api-key=f30d6a96-5fa2-4318-b2da-0f6d1deb5c83";
const DEVNET_PROVER_ENDPOINT =
  "https://mainnet.helius-rpc.com/?api-key=f30d6a96-5fa2-4318-b2da-0f6d1deb5c83";

// Create mainnet connection
const devnetConnection = createRpc(
  DEVNET_RPC_ENDPOINT,
  DEVNET_COMPRESS_RPC_ENDPOINT,
  DEVNET_PROVER_ENDPOINT,
  {
    commitment: "confirmed",
  }
);

const zkConfig = {
  rpcUrl: DEVNET_RPC_ENDPOINT,
  compressRpcEndpoint: DEVNET_COMPRESS_RPC_ENDPOINT,
  proverEndpoint: DEVNET_PROVER_ENDPOINT,
  commitment: "confirmed" as const,
};

const PAYER_KEYPAIR = anchor.web3.Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(
      fs.readFileSync("../../keys/signer_graphu_keypair.json", "utf-8")
    )
  )
);

// Using PAYER_KEYPAIR from common.ts instead of loading it again
const OWNER_KEYPAIR = PAYER_KEYPAIR;

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
let edgeAddress: PublicKey;
let secondNodeAddress: PublicKey; // For testing different source/target
let differentEdgeAddress: PublicKey; // For testing different nodes edge

describe("tapestry mainnet", () => {
  // Configure the client to use the mainnet cluster.
  const program = new Program<Tapestry>(
    idl as any,
    PROGRAM_ID,
    new anchor.AnchorProvider(
      devnetConnection,
      new anchor.Wallet(PAYER_KEYPAIR),
      {
        commitment: "confirmed",
      }
    )
  );

  it("Can create compressed account on mainnet", async () => {
    const seed = Keypair.generate().publicKey.toBytes();

    const txSig = await createAccount(
      devnetConnection,
      PAYER_KEYPAIR,
      [seed],
      program.programId,
      undefined,
      undefined,
      defaultTestStateTreeAccounts().merkleTree
    );
    console.log("Compressed account created on mainnet:", txSig);
  });

  it("Can create node on mainnet", async () => {
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
    const proof = await devnetConnection.getValidityProofV0(undefined, [
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
      label: "mainnet-test-node",
      properties: [
        {
          key: "description",
          value: "This is a test node on mainnet",
        },
        {
          key: "type",
          value: "test",
        },
      ],
      isMutable: true,
      creators: [
        {
          address: OWNER_KEYPAIR.publicKey,
          verified: true,
          share: 100,
        },
      ],
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
        payer: PAYER_KEYPAIR.publicKey,
        updateAuthority: PAYER_KEYPAIR.publicKey,
        owner: OWNER_KEYPAIR.publicKey,
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

    const blockhash = await devnetConnection.getLatestBlockhash();

    const tx = buildAndSignTx(
      [setComputeUnitLimitIx, setComputeUnitPriceIx, ix],
      PAYER_KEYPAIR,
      blockhash.blockhash
    );

    try {
      const signature = await sendAndConfirmTx(devnetConnection, tx, {
        commitment: "confirmed",
      });
      console.log("Transaction signature:", signature);
      console.log("Asset Address:", assetAddress.toBase58());
      console.log("Owner:", OWNER_KEYPAIR.publicKey.toBase58());
    } catch (error) {
      if (error instanceof SendTransactionError) {
        const logs = await error.getLogs(devnetConnection);
        console.error("Transaction failed with logs:", logs);
      }
      throw Error(error);
    }
  });

  it("Can create a second node for edge testing on mainnet", async () => {
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

    secondNodeAddress = deriveAddress(assetSeed, addressTree);

    // Get a fresh proof for the node address
    const proof = await devnetConnection.getValidityProofV0(undefined, [
      {
        address: bn(secondNodeAddress.toBytes()),
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
        Array.from(secondNodeAddress.toBytes()),
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
      label: "second-mainnet-test-node",
      properties: [
        {
          key: "description",
          value: "Second test node for edge testing on mainnet",
        },
        {
          key: "type",
          value: "test",
        },
      ],
      isMutable: true,
      creators: [
        {
          address: OWNER_KEYPAIR.publicKey,
          verified: true,
          share: 100,
        },
      ],
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
        payer: PAYER_KEYPAIR.publicKey,
        updateAuthority: PAYER_KEYPAIR.publicKey,
        owner: OWNER_KEYPAIR.publicKey,
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

    const blockhash = await devnetConnection.getLatestBlockhash();

    const tx = buildAndSignTx(
      [setComputeUnitLimitIx, setComputeUnitPriceIx, ix],
      PAYER_KEYPAIR,
      blockhash.blockhash
    );

    try {
      const signature = await sendAndConfirmTx(devnetConnection, tx, {
        commitment: "confirmed",
      });
      console.log("Transaction signature:", signature);
      console.log("Second Node Address:", secondNodeAddress.toBase58());
    } catch (error) {
      if (error instanceof SendTransactionError) {
        const logs = await error.getLogs(devnetConnection);
        console.error("Transaction failed with logs:", logs);
      }
      throw Error(error);
    }
  });

  it("Can create edge between different nodes on mainnet", async () => {
    const addressTree = defaultTestStateTreeAccounts().addressTree;
    const addressQueue = defaultTestStateTreeAccounts().addressQueue;
    const merkleTree = defaultTestStateTreeAccounts().merkleTree;

    // Generate random bytes for edge creation
    const randomBytes = anchor.web3.Keypair.generate().secretKey.slice(0, 32);
    const accountKeyEdge = Uint8Array.from([1]); // EdgeV1 key

    const edgeSeed = deriveAddressSeed(
      [accountKeyEdge, randomBytes],
      program.programId
    );

    differentEdgeAddress = deriveAddress(edgeSeed, addressTree);

    // Get a fresh proof for the edge address
    const proof = await devnetConnection.getValidityProofV0(undefined, [
      {
        address: bn(differentEdgeAddress.toBytes()),
        tree: addressTree,
        queue: addressQueue,
      },
    ]);

    // Create the new address parameters
    const newAddressParams: NewAddressParams = {
      seed: edgeSeed,
      addressMerkleTreeRootIndex: proof.rootIndices[0],
      addressMerkleTreePubkey: proof.merkleTrees[0],
      addressQueuePubkey: proof.nullifierQueues[0],
    };

    // Create the output compressed accounts
    const outputCompressedAccounts =
      LightSystemProgram.createNewAddressOutputState(
        Array.from(differentEdgeAddress.toBytes()),
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

    // Create edge arguments with different source and target nodes
    const edgeArgs = {
      sourceNode: assetAddress.toBase58(),
      targetNode: secondNodeAddress.toBase58(),
      properties: [
        { key: "timestamp", value: Date.now().toString() },
        { key: "weight", value: "10" },
        { key: "directed", value: "true" },
      ],
      isMutable: true,
    };

    const {
      accountCompressionAuthority,
      noopProgram,
      registeredProgramPda,
      accountCompressionProgram,
    } = defaultStaticAccountsStruct();

    // Create the instruction with the correct parameters
    const ix = await program.methods
      .createEdge(
        {
          a: proof.compressedProof.a,
          b: proof.compressedProof.b,
          c: proof.compressedProof.c,
        },
        newAddressParamsPacked[0].addressMerkleTreeRootIndex,
        Array.from(randomBytes),
        edgeArgs
      )
      .accounts({
        payer: PAYER_KEYPAIR.publicKey,
        updateAuthority: PAYER_KEYPAIR.publicKey,
        owner: OWNER_KEYPAIR.publicKey,
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

    const blockhash = await devnetConnection.getLatestBlockhash();

    const tx = buildAndSignTx(
      [setComputeUnitLimitIx, setComputeUnitPriceIx, ix],
      PAYER_KEYPAIR,
      blockhash.blockhash
    );

    try {
      const signature = await sendAndConfirmTx(devnetConnection, tx, {
        commitment: "confirmed",
      });
      console.log(
        "Edge created between nodes on mainnet. Signature:",
        signature
      );
      console.log("Edge Address:", differentEdgeAddress.toBase58());
    } catch (error) {
      if (error instanceof SendTransactionError) {
        const logs = await error.getLogs(devnetConnection);
        console.error("Transaction failed with logs:", logs);
      }
      throw Error(error);
    }
  });

  it("Can create edge between two ZK-compressed nodes using setupZKCompression on mainnet", async () => {
    // Setup first node (source)
    const umi = createUmi(DEVNET_RPC_ENDPOINT); // Replace with actual Umi instance if needed
    const sourceNodeSetup = await setupZKCompression(umi, program);
    const sourceNodeAddress = sourceNodeSetup.assetAddress;

    // Setup second node (target)
    const targetNodeSetup = await setupZKCompression(umi, program);
    const targetNodeAddress = targetNodeSetup.assetAddress;

    // Now create an edge between these two nodes
    // Generate random bytes for edge creation
    const randomBytes = anchor.web3.Keypair.generate().secretKey.slice(0, 32);
    const accountKeyEdge = Uint8Array.from([1]); // EdgeV1 key

    const edgeSeed = deriveAddressSeed(
      [accountKeyEdge, randomBytes],
      program.programId
    );

    const addressTree = new PublicKey(aT);
    const addressQueue = new PublicKey(aq);
    const merkleTree = new PublicKey(merkletreePubkey);
    const edgeAddress = deriveAddress(edgeSeed, addressTree);

    const zkConnection = createZKConnection(zkConfig);
    const proof = await zkConnection.getValidityProofV0(undefined, [
      {
        address: bn(edgeAddress.toBytes()),
        tree: addressTree,
        queue: addressQueue,
      },
    ]);

    const newAddressParams: NewAddressParams = {
      seed: edgeSeed,
      addressMerkleTreeRootIndex: proof.rootIndices[0],
      addressMerkleTreePubkey: proof.merkleTrees[0],
      addressQueuePubkey: proof.nullifierQueues[0],
    };

    const outputCompressedAccounts =
      LightSystemProgram.createNewAddressOutputState(
        Array.from(edgeAddress.toBytes()),
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

    // Create edge arguments with different source and target nodes
    const edgeArgs = {
      sourceNode: sourceNodeAddress.toBase58(),
      targetNode: targetNodeAddress.toBase58(),
      properties: [
        { key: "timestamp", value: Date.now().toString() },
        { key: "weight", value: "10" },
        { key: "directed", value: "true" },
      ],
      isMutable: true,
    };

    const {
      accountCompressionAuthority,
      noopProgram,
      registeredProgramPda,
      accountCompressionProgram,
    } = defaultStaticAccountsStruct();

    // Create the instruction with the correct parameters
    const ix = await program.methods
      .createEdge(
        {
          a: proof.compressedProof.a,
          b: proof.compressedProof.b,
          c: proof.compressedProof.c,
        },
        newAddressParamsPacked[0].addressMerkleTreeRootIndex,
        Array.from(randomBytes),
        edgeArgs
      )
      .accounts({
        payer: PAYER_KEYPAIR.publicKey,
        updateAuthority: PAYER_KEYPAIR.publicKey,
        owner: OWNER_KEYPAIR.publicKey,
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

    const blockhash = await devnetConnection.getLatestBlockhash();

    const tx = buildAndSignTx(
      [setComputeUnitLimitIx, setComputeUnitPriceIx, ix],
      PAYER_KEYPAIR,
      blockhash.blockhash
    );

    try {
      const signature = await sendAndConfirmTx(devnetConnection, tx, {
        commitment: "confirmed",
      });
      console.log(
        "Edge created between ZK-compressed nodes on mainnet. Signature:",
        signature
      );
      console.log("Edge Address:", edgeAddress.toBase58());
    } catch (error) {
      if (error instanceof SendTransactionError) {
        const logs = await error.getLogs(devnetConnection);
        console.error("Transaction failed with logs:", logs);
      }
      throw Error(error);
    }
  });

  it("can fetch nodes by program ID on mainnet", async () => {
    // Get all nodes for the program
    const nodes = await devnetConnection.getCompressedAccountsByOwner(
      program.programId,
      {}
    );

    console.log("Nodes by program ID count:", nodes.items.length);
    console.log("Program ID:", program.programId.toBase58());

    // Let's also try with memcmp filter on owner
    const nodesWithOwnerFilter =
      await devnetConnection.getCompressedAccountsByOwner(program.programId, {
        filters: [
          {
            memcmp: {
              bytes: OWNER_KEYPAIR.publicKey.toBase58(),
              offset: 1, // Owner should be at offset 1 after the key byte
            },
          },
        ],
      });
    console.log(
      "Nodes with owner filter count:",
      nodesWithOwnerFilter.items.length
    );

    expect(nodes.items.length).toBeGreaterThan(0);
  });

  it("can fetch and decode specific node on mainnet", async () => {
    // wait longer for indexing
    const node = await devnetConnection.getCompressedAccount(
      bn(assetAddress.toBytes())
    );
    expect(node.data.data.length).toBeGreaterThan(0);

    const decodedNode = borsh.deserialize(NodeSchemaV1, node.data.data) as any;

    expect(decodedNode.key).toBe(0);
    expect(new PublicKey(decodedNode.owner).toBase58()).toBe(
      OWNER_KEYPAIR.publicKey.toBase58()
    );
    expect(decodedNode.label).toBe("mainnet-test-node");
    expect(decodedNode.isMutable).toBe(true);

    if (decodedNode.nodeData?.propertiesBytes) {
      const properties = borsh.deserialize(
        { array: { type: propertiesSchema } },
        decodedNode.nodeData.propertiesBytes
      ) as any[];

      expect(properties).toHaveLength(2);
      expect(properties[0].key).toBe("description");
      expect(properties[1].key).toBe("type");
    }

    if (decodedNode.nodeData?.creatorsBytes) {
      const creators = borsh.deserialize(
        { array: { type: creatorSchema } },
        decodedNode.nodeData.creatorsBytes
      ) as any[];

      expect(creators).toHaveLength(1);
      expect(new PublicKey(creators[0].address).toBase58()).toBe(
        OWNER_KEYPAIR.publicKey.toBase58()
      );
      expect(creators[0].verified).toBe(true);
      expect(creators[0].share).toBe(100);
    }
  });
});
