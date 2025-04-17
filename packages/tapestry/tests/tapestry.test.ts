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
import {
  PROGRAM_ID,
  propertiesSchema,
  creatorSchema,
  rawNodeSchema as NodeSchemaV1,
  rawEdgeSchema,
} from "../src";

import {
  connection as rpc,
  connectionWithCustomIndexer,
  PAYER_KEYPAIR,
  NAME_KEYPAIR,
} from "./common";

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
        payer: NAME_KEYPAIR.publicKey,
        updateAuthority: NAME_KEYPAIR.publicKey,
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
      console.log("Owner:", OWNER_KEYPAIR.publicKey.toBase58());
    } catch (error) {
      if (error instanceof SendTransactionError) {
        const logs = await error.getLogs(rpc);
        console.error("Transaction failed with logs:", logs);
      }
      throw Error(error);
    }
  });

  it("Can create a second node for edge testing", async () => {
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
    const proof = await rpc.getValidityProofV0(undefined, [
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
      label: "second-test-node",
      properties: [
        {
          key: "description",
          value: "Second test node for edge testing",
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
        payer: NAME_KEYPAIR.publicKey,
        updateAuthority: NAME_KEYPAIR.publicKey,
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
      console.log("Second Node Address:", secondNodeAddress.toBase58());
    } catch (error) {
      if (error instanceof SendTransactionError) {
        const logs = await error.getLogs(rpc);
        console.error("Transaction failed with logs:", logs);
      }
      throw Error(error);
    }
  });

  it("Cannot create edge between the same node (self-reference)", async () => {
    const addressTree = defaultTestStateTreeAccounts().addressTree;
    const addressQueue = defaultTestStateTreeAccounts().addressQueue;
    const merkleTree = defaultTestStateTreeAccounts().merkleTree;

    // Generate proper random bytes for edge creation
    const randomBytes = anchor.web3.Keypair.generate().secretKey.slice(0, 32);
    const accountKeyEdge = Uint8Array.from([1]); // EdgeV1 key

    const edgeSeed = deriveAddressSeed(
      [accountKeyEdge, randomBytes],
      program.programId
    );

    edgeAddress = deriveAddress(edgeSeed, addressTree);

    // Get a fresh proof for the edge address
    const proof = await rpc.getValidityProofV0(undefined, [
      {
        address: bn(edgeAddress.toBytes()),
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

    // Create edge arguments with same source and target node
    const edgeArgs = {
      sourceNode: "node-1", // Use the previously created node as source
      targetNode: "node-1", // For testing, we'll use the same node as target
      properties: [
        {
          key: "description",
          value: "This is a test edge",
        },
        {
          key: "type",
          value: "test",
        },
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
        payer: NAME_KEYPAIR.publicKey,
        updateAuthority: NAME_KEYPAIR.publicKey,
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

    const blockhash = await rpc.getLatestBlockhash();

    const tx = buildAndSignTx(
      [setComputeUnitLimitIx, setComputeUnitPriceIx, ix],
      NAME_KEYPAIR,
      blockhash.blockhash
    );

    try {
      await sendAndConfirmTx(rpc, tx, {
        commitment: "confirmed",
      });
      throw new Error(
        "Expected transaction to fail with SelfReferenceNotAllowed error"
      );
    } catch (error) {
      if (error instanceof SendTransactionError) {
        const logs = await error.getLogs(rpc);
        expect(
          logs.some((log) =>
            log.includes("Self-referencing edges are not allowed")
          )
        ).toBe(true);
      } else {
        throw error;
      }
    }
  });

  it("Can create edge between different nodes", async () => {
    const addressTree = defaultTestStateTreeAccounts().addressTree;
    const addressQueue = defaultTestStateTreeAccounts().addressQueue;
    const merkleTree = defaultTestStateTreeAccounts().merkleTree;

    // Generate proper random bytes for edge creation
    const randomBytes = anchor.web3.Keypair.generate().secretKey.slice(0, 32);
    const accountKeyEdge = Uint8Array.from([1]); // EdgeV1 key

    const edgeSeed = deriveAddressSeed(
      [accountKeyEdge, randomBytes],
      program.programId
    );

    differentEdgeAddress = deriveAddress(edgeSeed, addressTree);

    console.log("Different Edge Address:", differentEdgeAddress.toBase58());

    // Get a fresh proof for the edge address
    const proof = await rpc.getValidityProofV0(undefined, [
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
      sourceNode: "node-1", // First node
      targetNode: "node-2", // Second node
      properties: [
        {
          key: "timestamp",
          value: Date.now().toString(),
        },
        {
          key: "weight",
          value: "10",
        },
        {
          key: "directed",
          value: "true",
        },
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
        payer: NAME_KEYPAIR.publicKey,
        updateAuthority: NAME_KEYPAIR.publicKey,
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

    const blockhash = await rpc.getLatestBlockhash();

    const tx = buildAndSignTx(
      [setComputeUnitLimitIx, setComputeUnitPriceIx, ix],
      NAME_KEYPAIR,
      blockhash.blockhash
    );

    console.log("NAMEPAIR:", NAME_KEYPAIR.publicKey.toBase58());

    try {
      const signature = await sendAndConfirmTx(rpc, tx, {
        commitment: "confirmed",
        skipPreflight: true,
      });
      console.log(
        "Different nodes edge created: Transaction signature:",
        signature
      );
      console.log("Different Edge Address:", differentEdgeAddress.toBase58());
    } catch (error) {
      if (error instanceof SendTransactionError) {
        const logs = await error.getLogs(rpc);
        console.error("Transaction failed with logs:", logs);
      }
      throw Error(error);
    }
  });

  it("can find edges by filtering on source and target nodes", async () => {
    // Get all accounts for the program
    const allAccounts = await rpc.getCompressedAccountsByOwner(
      program.programId,
      {}
    );
    expect(allAccounts.items.length).toBeGreaterThan(0);

    // Function to check if an edge connects specific nodes
    const findEdgesBetweenNodes = (
      sourceNode: string,
      targetNode: string,
      accounts: any[]
    ) => {
      const matchingEdges = [];

      for (const item of accounts) {
        const data = Buffer.from(item.data.data);

        // Check if it's an EdgeV1
        if (data[0] === 1) {
          try {
            const edge = borsh.deserialize(rawEdgeSchema, data) as any;

            // Check if it connects the specified nodes
            if (
              edge.sourceNode === sourceNode &&
              edge.targetNode === targetNode
            ) {
              matchingEdges.push({
                address: item.address,
                edge: edge,
                data: data,
              });
            }
          } catch (err) {
            // Skip accounts that don't match our schema
          }
        }
      }

      return matchingEdges;
    };

    // Find edges from node1 to node2 (different nodes)
    const diffNodeEdges = findEdgesBetweenNodes(
      "node-1",
      "node-2",
      allAccounts.items
    );
    expect(diffNodeEdges.length).toBeGreaterThan(0);
    if (diffNodeEdges.length > 0) {
      const edge = diffNodeEdges[0].edge;
      // Check properties
      if (edge.edgeData?.propertiesBytes?.length > 0) {
        const properties = borsh.deserialize(
          { array: { type: propertiesSchema } },
          edge.edgeData.propertiesBytes
        ) as any[];

        // Validate complex properties
        const propMap = properties.reduce((map, prop) => {
          map[prop.key] = prop.value;
          return map;
        }, {});

        expect(propMap["weight"]).toBe("10");
        expect(propMap["directed"]).toBe("true");
      }
    }

    // Also test bulk edge querying by program ID to make sure it works
    const edges = await rpc.getCompressedAccountsByOwner(program.programId, {});
    console.log(`Found ${edges.items.length} total accounts by program ID`);
    expect(edges.items.length).toBeGreaterThan(0);
  });

  it("can fetch nodes by program ID", async () => {
    // wait longer for indexing

    const nodes = await rpc.getCompressedAccountsByOwner(program.programId, {});

    console.log("Nodes by program ID count:", nodes.items.length);
    console.log("Program ID:", program.programId.toBase58());

    // Let's also try with memcmp filter on owner
    const nodesWithOwnerFilter = await rpc.getCompressedAccountsByOwner(
      program.programId,
      {
        filters: [
          {
            memcmp: {
              bytes: OWNER_KEYPAIR.publicKey.toBase58(),
              offset: 1, // Owner should be at offset 1 after the key byte
            },
          },
        ],
      }
    );
    console.log(
      "Nodes with owner filter count:",
      nodesWithOwnerFilter.items.length
    );

    expect(nodes.items.length).toBeGreaterThan(0);
  });

  it("can fetch nodes by program ID and filter by owner", async () => {
    // Get all nodes for the program
    const allNodes = await rpc.getCompressedAccountsByOwner(
      program.programId,
      {}
    );
    expect(allNodes.items.length).toBeGreaterThan(0);

    // Get nodes filtered by owner using memcmp
    const ownerNodes = await rpc.getCompressedAccountsByOwner(
      program.programId,
      {
        filters: [
          {
            memcmp: {
              bytes: OWNER_KEYPAIR.publicKey.toBase58(),
              offset: 1, // Owner is at offset 1 after the key byte
            },
          },
        ],
      }
    );

    // Verify we got the correct nodes
    expect(ownerNodes.items.length).toBeGreaterThan(0);
    expect(ownerNodes.items.length).toBeLessThanOrEqual(allNodes.items.length);

    // Verify the owner filter worked by checking the first node
    const firstNode = borsh.deserialize(
      NodeSchemaV1,
      ownerNodes.items[0].data.data
    ) as any;
    expect(new PublicKey(firstNode.owner).toBase58()).toBe(
      OWNER_KEYPAIR.publicKey.toBase58()
    );
  });

  it("can fetch and decode specific node", async () => {
    // wait longer for indexing
    const node = await rpc.getCompressedAccount(bn(assetAddress.toBytes()));
    expect(node.data.data.length).toBeGreaterThan(0);

    const decodedNode = borsh.deserialize(NodeSchemaV1, node.data.data) as any;

    expect(decodedNode.key).toBe(0);
    expect(new PublicKey(decodedNode.owner).toBase58()).toBe(
      OWNER_KEYPAIR.publicKey.toBase58()
    );
    expect(decodedNode.label).toBe("test-node");
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

  it("can decode and validate edge data", async () => {
    // wait for indexing
    console.log("Different Edge Address:", differentEdgeAddress.toBase58());
    const edge = await rpc.getCompressedAccount(
      bn(differentEdgeAddress.toBytes())
    );
    console.log("Edge data:", edge);
    const buffer = Buffer.from(edge.data.data);
    expect(buffer.length).toBeGreaterThan(0);

    // Decode the edge
    const decodedEdge = borsh.deserialize(rawEdgeSchema, buffer) as any;

    // Validate basic fields
    expect(decodedEdge.key).toBe(1); // EdgeV1 key
    expect(decodedEdge.sourceNode).toBe("node-1");
    expect(decodedEdge.targetNode).toBe("node-2");
    expect(new PublicKey(decodedEdge.owner).toBase58()).toBe(
      OWNER_KEYPAIR.publicKey.toBase58()
    );
    expect(decodedEdge.isMutable).toBe(true);

    // Validate properties
    if (decodedEdge.edgeData?.propertiesBytes?.length > 0) {
      const properties = borsh.deserialize(
        { array: { type: propertiesSchema } },
        decodedEdge.edgeData.propertiesBytes
      ) as any[];

      expect(properties.length).toBe(3);
      expect(properties[0].key).toBe("timestamp");
      expect(properties[1].key).toBe("weight");
      expect(properties[1].value).toBe("10");
      expect(properties[2].key).toBe("directed");
      expect(properties[2].value).toBe("true");
    }
  });

  it.skip("can fetch and decode edge data using custom indexer", async () => {
    // wait for indexing
    const edge = await connectionWithCustomIndexer.getCompressedAccount(
      bn(differentEdgeAddress.toBytes())
    );
    const buffer = Buffer.from(edge.data.data);
    expect(buffer.length).toBeGreaterThan(0);

    // Decode the edge
    const decodedEdge = borsh.deserialize(rawEdgeSchema, buffer) as any;

    // Validate basic fields
    expect(decodedEdge.key).toBe(1); // EdgeV1 key
    expect(decodedEdge.sourceNode).toBe("node-1");
    expect(decodedEdge.targetNode).toBe("node-2");
    expect(new PublicKey(decodedEdge.owner).toBase58()).toBe(
      OWNER_KEYPAIR.publicKey.toBase58()
    );
    expect(decodedEdge.isMutable).toBe(true);

    // Validate properties
    if (decodedEdge.edgeData?.propertiesBytes?.length > 0) {
      const properties = borsh.deserialize(
        { array: { type: propertiesSchema } },
        decodedEdge.edgeData.propertiesBytes
      ) as any[];

      expect(properties.length).toBe(3);
      expect(properties[0].key).toBe("timestamp");
      expect(properties[1].key).toBe("weight");
      expect(properties[1].value).toBe("10");
      expect(properties[2].key).toBe("directed");
      expect(properties[2].value).toBe("true");
    }

    // Additional validation specific to custom indexer
    expect(edge.address).toBeDefined();
    expect(edge.data).toBeDefined();
    expect(edge.data.data).toBeDefined();
  });
  it("can create and verify 5 nodes and 5 edges", async () => {
    const addressTree = defaultTestStateTreeAccounts().addressTree;
    const addressQueue = defaultTestStateTreeAccounts().addressQueue;
    const merkleTree = defaultTestStateTreeAccounts().merkleTree;

    // Create arrays to store node and edge addresses
    const nodeAddresses: PublicKey[] = [];
    const edgeAddresses: PublicKey[] = [];

    // Create 5 nodes in parallel
    const nodePromises = Array.from({ length: 5 }, async (_, i) => {
      const randomBytes = anchor.web3.Keypair.generate().secretKey.slice(0, 32);
      const accountKeyNode = Uint8Array.from([0]);

      const assetSeed = deriveAddressSeed(
        [accountKeyNode, randomBytes],
        program.programId
      );

      const nodeAddress = deriveAddress(assetSeed, addressTree);
      nodeAddresses.push(nodeAddress);

      // Get a fresh proof for the node address
      const proof = await rpc.getValidityProofV0(undefined, [
        {
          address: bn(nodeAddress.toBytes()),
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
          Array.from(nodeAddress.toBytes()),
          program.programId
        );

      const { remainingAccounts: _remainingAccounts } = packCompressedAccounts(
        [],
        [],
        outputCompressedAccounts,
        merkleTree
      );
      const { newAddressParamsPacked, remainingAccounts } =
        packNewAddressParams([newAddressParams], _remainingAccounts);

      // Create node arguments with unique properties
      const nodeArgs = {
        label: `node-${i + 1}`,
        properties: [
          {
            key: "description",
            value: `This is node ${i + 1}`,
          },
          {
            key: "type",
            value: "test",
          },
          {
            key: "index",
            value: i.toString(),
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

      // Create the instruction
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
        return nodeAddress;
      } catch (error) {
        if (error instanceof SendTransactionError) {
          const logs = await error.getLogs(rpc);
          console.error("Transaction failed with logs:", logs);
        }
        throw Error(error);
      }
    });

    // Wait for all nodes to be created
    await Promise.all(nodePromises);

    // Create 5 edges in parallel
    const edgePromises = Array.from({ length: 5 }, async (_, i) => {
      const randomBytes = anchor.web3.Keypair.generate().secretKey.slice(0, 32);
      const accountKeyEdge = Uint8Array.from([1]);

      const edgeSeed = deriveAddressSeed(
        [accountKeyEdge, randomBytes],
        program.programId
      );

      const edgeAddress = deriveAddress(edgeSeed, addressTree);
      edgeAddresses.push(edgeAddress);

      // Get a fresh proof for the edge address
      const proof = await rpc.getValidityProofV0(undefined, [
        {
          address: bn(edgeAddress.toBytes()),
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
          Array.from(edgeAddress.toBytes()),
          program.programId
        );

      const { remainingAccounts: _remainingAccounts } = packCompressedAccounts(
        [],
        [],
        outputCompressedAccounts,
        merkleTree
      );
      const { newAddressParamsPacked, remainingAccounts } =
        packNewAddressParams([newAddressParams], _remainingAccounts);

      // Create edge arguments connecting nodes in a chain
      const sourceNode = nodeAddresses[i];
      const targetNode = nodeAddresses[(i + 1) % 5]; // Connect to next node, or first node for last edge

      const edgeArgs = {
        sourceNode: `node-${i + 1}`,
        targetNode: `node-${((i + 1) % 5) + 1}`,
        properties: [
          {
            key: "timestamp",
            value: Date.now().toString(),
          },
          {
            key: "weight",
            value: (i + 1).toString(),
          },
          {
            key: "directed",
            value: "true",
          },
        ],
        isMutable: true,
      };

      const {
        accountCompressionAuthority,
        noopProgram,
        registeredProgramPda,
        accountCompressionProgram,
      } = defaultStaticAccountsStruct();

      // Create the instruction
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
          payer: NAME_KEYPAIR.publicKey,
          updateAuthority: NAME_KEYPAIR.publicKey,
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

        return edgeAddress;
      } catch (error) {
        if (error instanceof SendTransactionError) {
          const logs = await error.getLogs(rpc);
          console.error("Transaction failed with logs:", logs);
        }
        throw Error(error);
      }
    });

    // Wait for all edges to be created
    await Promise.all(edgePromises);

    // Verify all nodes and edges were created correctly
    const allAccounts = await rpc.getCompressedAccountsByOwner(
      program.programId,
      {}
    );

    // Verify nodes in parallel
    const nodeVerificationPromises = Array.from({ length: 5 }, async (_, i) => {
      const node = await rpc.getCompressedAccount(
        bn(nodeAddresses[i].toBytes())
      );
      const decodedNode = borsh.deserialize(
        NodeSchemaV1,
        node.data.data
      ) as any;

      expect(decodedNode.key).toBe(0);
      expect(decodedNode.label).toBe(`node-${i + 1}`);
      expect(decodedNode.isMutable).toBe(true);

      // Verify properties
      if (decodedNode.nodeData?.propertiesBytes) {
        const properties = borsh.deserialize(
          { array: { type: propertiesSchema } },
          decodedNode.nodeData.propertiesBytes
        ) as any[];

        expect(properties).toHaveLength(3);
        expect(properties[0].key).toBe("description");
        expect(properties[1].key).toBe("type");
        expect(properties[2].key).toBe("index");
        expect(properties[2].value).toBe(i.toString());
      }
    });

    // Verify edges in parallel
    const edgeVerificationPromises = Array.from({ length: 5 }, async (_, i) => {
      const edge = await rpc.getCompressedAccount(
        bn(edgeAddresses[i].toBytes())
      );
      const decodedEdge = borsh.deserialize(
        rawEdgeSchema,
        edge.data.data
      ) as any;

      expect(decodedEdge.key).toBe(1);
      expect(decodedEdge.sourceNode).toBe(`node-${i + 1}`);
      expect(decodedEdge.targetNode).toBe(`node-${((i + 1) % 5) + 1}`);
      expect(decodedEdge.isMutable).toBe(true);

      // Verify properties
      if (decodedEdge.edgeData?.propertiesBytes) {
        const properties = borsh.deserialize(
          { array: { type: propertiesSchema } },
          decodedEdge.edgeData.propertiesBytes
        ) as any[];

        expect(properties).toHaveLength(3);
        expect(properties[0].key).toBe("timestamp");
        expect(properties[1].key).toBe("weight");
        expect(properties[1].value).toBe((i + 1).toString());
        expect(properties[2].key).toBe("directed");
        expect(properties[2].value).toBe("true");
      }
    });

    // Wait for all verifications to complete
    await Promise.all([
      ...nodeVerificationPromises,
      ...edgeVerificationPromises,
    ]);
  });

  it("compares performance between regular RPC and custom indexer with many accounts", async () => {
    // Test regular RPC connection
    console.log("\nTesting regular RPC connection...");
    const rpcStartTime = Date.now();
    const rpcAccounts = await rpc.getCompressedAccountsByOwner(
      program.programId,
      {}
    );
    const rpcEndTime = Date.now();
    const rpcDuration = rpcEndTime - rpcStartTime;
    console.log(
      `Regular RPC took ${rpcDuration}ms to fetch ${rpcAccounts.items.length} accounts`
    );

    // Test custom indexer connection
    console.log("\nTesting custom indexer connection...");
    const indexerStartTime = Date.now();
    const indexerAccounts =
      await connectionWithCustomIndexer.getCompressedAccountsByOwner(
        program.programId,
        {}
      );
    const indexerEndTime = Date.now();
    const indexerDuration = indexerEndTime - indexerStartTime;
    console.log(
      `Custom indexer took ${indexerDuration}ms to fetch ${indexerAccounts.items.length} accounts`
    );

    // Compare results
    console.log("\nPerformance comparison:");
    console.log(
      `Regular RPC: ${rpcDuration}ms (${rpcAccounts.items.length} accounts)`
    );
    console.log(
      `Custom Indexer: ${indexerDuration}ms (${indexerAccounts.items.length} accounts)`
    );
    console.log(
      `Speed improvement: ${(
        ((rpcDuration - indexerDuration) / rpcDuration) *
        100
      ).toFixed(2)}%`
    );

    // Verify we got the same number of accounts
    expect(indexerAccounts.items.length).toBe(rpcAccounts.items.length);

    // Verify the data is consistent by checking a few accounts
    const sampleSize = Math.min(5, rpcAccounts.items.length);
    for (let i = 0; i < sampleSize; i++) {
      const rpcAccount = rpcAccounts.items[i];
      const indexerAccount = indexerAccounts.items[i];

      // Compare addresses by converting to base58 strings
      expect(new PublicKey(rpcAccount.address).toBase58()).toBe(
        new PublicKey(indexerAccount.address).toBase58()
      );
      // Compare data content
      expect(
        Buffer.from(rpcAccount.data.data).equals(
          Buffer.from(indexerAccount.data.data)
        )
      ).toBe(true);
    }
  });

  it("can fetch transaction with compression info", async () => {
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

    const nodeAddress = deriveAddress(assetSeed, addressTree);

    // Get a fresh proof for the node address
    const proof = await rpc.getValidityProofV0(undefined, [
      {
        address: bn(nodeAddress.toBytes()),
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
        Array.from(nodeAddress.toBytes()),
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

    // Create node arguments
    const nodeArgs = {
      label: "compression-test-node",
      properties: [
        {
          key: "description",
          value: "Testing compression info",
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

    // Create the instruction
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

    const blockhash = await rpc.getLatestBlockhash();

    const tx = buildAndSignTx(
      [setComputeUnitLimitIx, setComputeUnitPriceIx, ix],
      NAME_KEYPAIR,
      blockhash.blockhash
    );

    let signature: string;
    try {
      signature = await sendAndConfirmTx(rpc, tx, {
        commitment: "confirmed",
      });
      console.log("Transaction signature:", signature);
    } catch (error) {
      if (error instanceof SendTransactionError) {
        const logs = await error.getLogs(rpc);
        console.error("Transaction failed with logs:", logs);
      }
      throw Error(error);
    }

    // Wait a bit for indexing

    // Now fetch and verify the transaction compression info
    const txWithCompressionInfo = await rpc.getTransactionWithCompressionInfo(
      signature
    );
    expect(txWithCompressionInfo).not.toBeNull();
    // Verify compression info structure
    expect(txWithCompressionInfo.compressionInfo).toBeDefined();
    expect(txWithCompressionInfo.transaction).toBeDefined();

    // Verify opened accounts (new node creation)
    expect(txWithCompressionInfo.compressionInfo.openedAccounts).toBeDefined();
    expect(
      txWithCompressionInfo.compressionInfo.openedAccounts.length
    ).toBeGreaterThan(0);

    const openedAccount =
      txWithCompressionInfo.compressionInfo.openedAccounts[0];
    expect(openedAccount.account).toBeDefined();
    expect(openedAccount.account.owner.toBase58()).toBe(
      program.programId.toBase58()
    );

    // print owner
    console.log("owner: ", openedAccount.account.owner.toBase58());
    expect(openedAccount.account.leafIndex).toBeDefined();

    // Verify the node data
    const buffer = Buffer.from(openedAccount.account.data.data);
    const decodedNode = borsh.deserialize(NodeSchemaV1, buffer) as any;
    expect(decodedNode.label).toBe("compression-test-node");
    expect(decodedNode.key).toBe(0); // NodeV1 key
    expect(new PublicKey(decodedNode.owner).toBase58()).toBe(
      OWNER_KEYPAIR.publicKey.toBase58()
    );

    // Verify properties
    if (decodedNode.nodeData?.propertiesBytes) {
      const properties = borsh.deserialize(
        { array: { type: propertiesSchema } },
        decodedNode.nodeData.propertiesBytes
      ) as any[];

      expect(properties).toHaveLength(2);
      expect(properties[0].key).toBe("description");
      expect(properties[0].value).toBe("Testing compression info");
      expect(properties[1].key).toBe("type");
      expect(properties[1].value).toBe("test");
    }
    console.log("signature: ", signature);
    // Verify transaction data
    expect(txWithCompressionInfo.transaction.transaction[0]).toBeDefined();
    expect(txWithCompressionInfo.transaction.meta.err).toBeNull();
    expect(txWithCompressionInfo.transaction.meta.status.ok).toBeDefined();
    expect(txWithCompressionInfo.transaction.blockTime).toBeDefined();
    expect(txWithCompressionInfo.transaction.slot).toBeDefined();
  });
});
