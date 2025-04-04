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
  rawNodeSchema,
  edgeSchemaV1,
  rawEdgeSchema,
} from "../src";

import { connection as rpc, PAYER_KEYPAIR, NAME_KEYPAIR } from "./common";

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

  it("Can create edge between the same node (self-reference)", async () => {
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

    // Create edge arguments according to the IDL structure
    const edgeArgs = {
      sourceNode: assetAddress, // Use the previously created node as source
      targetNode: assetAddress, // For testing, we'll use the same node as target
      edgeType: "test-connection",
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
      const signature = await sendAndConfirmTx(rpc, tx, {
        commitment: "confirmed",
      });
      console.log(
        "Self-referencing edge created: Transaction signature:",
        signature
      );
      console.log("Edge Address:", edgeAddress.toBase58());
    } catch (error) {
      if (error instanceof SendTransactionError) {
        const logs = await error.getLogs(rpc);
        console.error("Transaction failed with logs:", logs);
      }
      throw Error(error);
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

    const differentEdgeAddress = deriveAddress(edgeSeed, addressTree);

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
      sourceNode: assetAddress, // First node
      targetNode: secondNodeAddress, // Second node
      edgeType: "node-connection",
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

    try {
      const signature = await sendAndConfirmTx(rpc, tx, {
        commitment: "confirmed",
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
      sourceNode: PublicKey,
      targetNode: PublicKey,
      accounts: any[]
    ) => {
      const matchingEdges = [];

      for (const item of accounts) {
        const data = Buffer.from(item.data.data);

        // Check if it's an EdgeV1
        if (data[0] === 1) {
          try {
            const edge = borsh.deserialize(rawEdgeSchema, data) as any;
            const edgeSourceNode = new PublicKey(edge.sourceNode);
            const edgeTargetNode = new PublicKey(edge.targetNode);

            // Check if it connects the specified nodes
            if (
              edgeSourceNode.equals(sourceNode) &&
              edgeTargetNode.equals(targetNode)
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

    // Find edges from node1 to node1 (self-reference)
    const selfEdges = findEdgesBetweenNodes(
      assetAddress,
      assetAddress,
      allAccounts.items
    );
    expect(selfEdges.length).toBeGreaterThan(0);
    if (selfEdges.length > 0) {
      const firstEdge = selfEdges[0].edge;
      expect(firstEdge.edgeType).toBe("test-connection");
    }

    // Find edges from node1 to node2
    const diffNodeEdges = findEdgesBetweenNodes(
      assetAddress,
      secondNodeAddress,
      allAccounts.items
    );
    expect(diffNodeEdges.length).toBeGreaterThan(0);
    if (diffNodeEdges.length > 0) {
      const edge = diffNodeEdges[0].edge;
      expect(edge.edgeType).toBe("node-connection");

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
      rawNodeSchema,
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

    const decodedNode = borsh.deserialize(rawNodeSchema, node.data.data) as any;

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
    const edge = await rpc.getCompressedAccount(bn(edgeAddress.toBytes()));
    const buffer = Buffer.from(edge.data.data);
    expect(buffer.length).toBeGreaterThan(0);

    // Decode the edge
    const decodedEdge = borsh.deserialize(rawEdgeSchema, buffer) as any;

    // Validate basic fields
    expect(decodedEdge.key).toBe(1); // EdgeV1 key
    expect(new PublicKey(decodedEdge.sourceNode).toBase58()).toBe(
      assetAddress.toBase58()
    );
    expect(new PublicKey(decodedEdge.targetNode).toBase58()).toBe(
      assetAddress.toBase58()
    );
    expect(decodedEdge.edgeType).toBe("test-connection");
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

      expect(properties.length).toBe(2);
      expect(properties[0].key).toBe("description");
      expect(properties[0].value).toBe("This is a test edge");
      expect(properties[1].key).toBe("type");
      expect(properties[1].value).toBe("test");
    }
  });
});
