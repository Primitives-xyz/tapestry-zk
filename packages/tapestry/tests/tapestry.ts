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
} from "@lightprotocol/stateless.js";
import fs from "fs";
import { expect, test, describe, it } from "bun:test";
import { Connection, Keypair, SendTransactionError } from "@solana/web3.js";
import idl from "../target/idl/tapestry.json";
import * as borsh from "borsh";

import "dotenv/config";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import { assetSchemaV1, metadataSchemaV1 } from "../src";

console.log("Starting test file execution");

const { PublicKey } = anchor.web3;

const keypair = anchor.web3.Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(fs.readFileSync("target/deploy/name.json", "utf-8"))
  )
);
console.log("Loaded keypair from file");

const setComputeUnitLimitIx =
  anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({
    units: 900_000,
  });
const setComputeUnitPriceIx =
  anchor.web3.ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 1,
  });

describe("tapestry", () => {
  console.log("Starting tapestry test suite");

  // Configure the client to use the local cluster.
  console.log("Creating program instance");
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
      new anchor.Wallet(keypair),
      {
        commitment: "confirmed",
      }
    )
  );
  console.log("Program instance created");

  console.log(
    "Creating RPC connection: ",
    program.provider.connection.rpcEndpoint
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
  console.log("RPC connection created");

  it.skip("Can create compressed account", async () => {
    console.log("Starting 'Can create compressed account' test");
    const seed = Keypair.generate().publicKey.toBytes();
    console.log("Generated seed");

    console.log("About to call createAccount");
    const txSig = await createAccount(
      connection,
      keypair,
      seed,
      program.programId,
      undefined,
      undefined,
      undefined
    );
    console.log("createAccount completed");

    console.log("Your transaction signature", txSig);
  });

  const LOOKUP_TABLE_ADDRESS = // new PublicKey("Dh74qoNrgMYzk4ZFZenKS2f9gSA9AqXrcgYzyBia1r3W") // prod lookup table
    new PublicKey("3UQtx7pqXu2jZADF8YW3uaFq7EzASs55rZzxSRCibqb7"); // dev lookup table
  const METADATA_URIS = [
    "https://files.tinys.pl/zkN5FTcJzrwp2c9G4fL3qXo9tnVhiACG3xzoP3tV3Hh/1.json",
    "https://files.tinys.pl/zkN5FTcJzrwp2c9G4fL3qXo9tnVhiACG3xzoP3tV3Hh/2.json",
    "https://files.tinys.pl/zkN5FTcJzrwp2c9G4fL3qXo9tnVhiACG3xzoP3tV3Hh/3.json",
    "https://files.tinys.pl/zkN5FTcJzrwp2c9G4fL3qXo9tnVhiACG3xzoP3tV3Hh/4.json",
    "https://files.tinys.pl/zkN5FTcJzrwp2c9G4fL3qXo9tnVhiACG3xzoP3tV3Hh/5.json",
    "https://files.tinys.pl/zkN5FTcJzrwp2c9G4fL3qXo9tnVhiACG3xzoP3tV3Hh/6.json",
    "https://files.tinys.pl/zkN5FTcJzrwp2c9G4fL3qXo9tnVhiACG3xzoP3tV3Hh/7.json",
    "https://files.tinys.pl/zkN5FTcJzrwp2c9G4fL3qXo9tnVhiACG3xzoP3tV3Hh/8.json",
    "https://files.tinys.pl/zkN5FTcJzrwp2c9G4fL3qXo9tnVhiACG3xzoP3tV3Hh/9.json",
    "https://files.tinys.pl/zkN5FTcJzrwp2c9G4fL3qXo9tnVhiACG3xzoP3tV3Hh/10.json",
    "https://files.tinys.pl/zkN5FTcJzrwp2c9G4fL3qXo9tnVhiACG3xzoP3tV3Hh/11.json",
    "https://files.tinys.pl/zkN5FTcJzrwp2c9G4fL3qXo9tnVhiACG3xzoP3tV3Hh/12.json",
    "https://files.tinys.pl/zkN5FTcJzrwp2c9G4fL3qXo9tnVhiACG3xzoP3tV3Hh/13.json",
    "https://files.tinys.pl/zkN5FTcJzrwp2c9G4fL3qXo9tnVhiACG3xzoP3tV3Hh/14.json",
    "https://files.tinys.pl/zkN5FTcJzrwp2c9G4fL3qXo9tnVhiACG3xzoP3tV3Hh/15.json",
    "https://files.tinys.pl/zkN5FTcJzrwp2c9G4fL3qXo9tnVhiACG3xzoP3tV3Hh/16.json",
    "https://files.tinys.pl/zkN5FTcJzrwp2c9G4fL3qXo9tnVhiACG3xzoP3tV3Hh/17.json",
    "https://files.tinys.pl/zkN5FTcJzrwp2c9G4fL3qXo9tnVhiACG3xzoP3tV3Hh/18.json",
    "https://files.tinys.pl/zkN5FTcJzrwp2c9G4fL3qXo9tnVhiACG3xzoP3tV3Hh/19.json",
    "https://files.tinys.pl/zkN5FTcJzrwp2c9G4fL3qXo9tnVhiACG3xzoP3tV3Hh/20.json",
    "https://files.tinys.pl/zkN5FTcJzrwp2c9G4fL3qXo9tnVhiACG3xzoP3tV3Hh/21.json",
    "https://files.tinys.pl/zkN5FTcJzrwp2c9G4fL3qXo9tnVhiACG3xzoP3tV3Hh/22.json",
    "https://files.tinys.pl/zkN5FTcJzrwp2c9G4fL3qXo9tnVhiACG3xzoP3tV3Hh/23.json",
    "https://files.tinys.pl/zkN5FTcJzrwp2c9G4fL3qXo9tnVhiACG3xzoP3tV3Hh/24.json",
    "https://files.tinys.pl/zkN5FTcJzrwp2c9G4fL3qXo9tnVhiACG3xzoP3tV3Hh/25.json",
    "https://files.tinys.pl/zkN5FTcJzrwp2c9G4fL3qXo9tnVhiACG3xzoP3tV3Hh/26.json",
    "https://files.tinys.pl/zkN5FTcJzrwp2c9G4fL3qXo9tnVhiACG3xzoP3tV3Hh/27.json",
    "https://files.tinys.pl/zkN5FTcJzrwp2c9G4fL3qXo9tnVhiACG3xzoP3tV3Hh/28.json",
    "https://files.tinys.pl/zkN5FTcJzrwp2c9G4fL3qXo9tnVhiACG3xzoP3tV3Hh/29.json",
    "https://files.tinys.pl/zkN5FTcJzrwp2c9G4fL3qXo9tnVhiACG3xzoP3tV3Hh/30.json",
    "https://files.tinys.pl/zkN5FTcJzrwp2c9G4fL3qXo9tnVhiACG3xzoP3tV3Hh/31.json",
    "https://files.tinys.pl/zkN5FTcJzrwp2c9G4fL3qXo9tnVhiACG3xzoP3tV3Hh/32.json",
  ];

  const updateAuthority = Keypair.generate();
  // const updateAuthority = Keypair.fromSecretKey(
  //   Uint8Array.from(
  //     JSON.parse(
  //       fs.readFileSync("target/deploy/update-authority-keypair.json", "utf-8")
  //     )
  //   )
  // );
  const randomBytes = Keypair.generate().publicKey.toBytes();
  const recipient = Keypair.generate();
  // const recipient = keypair;
  const METADATA_URI =
    METADATA_URIS[Math.floor(Math.random() * METADATA_URIS.length)];
  it("Can create asset", async () => {
    console.log("Starting 'Can create asset' test");
    console.log("Getting defaultTestStateTreeAccounts");
    const addressTree = defaultTestStateTreeAccounts().addressTree;
    const addressQueue = defaultTestStateTreeAccounts().addressQueue;
    console.log("Got addressTree and addressQueue");

    console.log("Generating assetSeed");
    const assetSeed = await hashToBn254FieldSizeBe(
      Buffer.from([1, ...program.programId.toBytes(), ...randomBytes])
    );
    console.log("Generated assetSeed");

    console.log("Deriving assetAddress");
    const assetAddress = await deriveAddress(assetSeed[0], addressTree);
    console.log("Derived assetAddress:", assetAddress.toBase58());

    console.log("Generating metadataSeed");
    const metadataSeed = await hashToBn254FieldSizeBe(
      Buffer.from([
        2,
        ...program.programId.toBytes(),
        ...assetAddress.toBytes(),
      ])
    );
    console.log("Generated metadataSeed");

    console.log("Deriving metadataAddress");
    const metadataAddress = await deriveAddress(metadataSeed[0], addressTree);
    console.log("Derived metadataAddress:", metadataAddress.toBase58());

    console.log("About to call getValidityProofV0");

    console.log({
      compressionApiEndpoint: connection.compressionApiEndpoint,
      rpcEndpoint: connection.rpcEndpoint,
      provider: connection.proverEndpoint,
    });
    const proof = await connection.getValidityProofV0(undefined, [
      {
        address: bn(assetAddress.toBytes()),
        tree: addressTree,
        queue: addressQueue,
      },
      {
        address: bn(metadataAddress.toBytes()),
        tree: addressTree,
        queue: addressQueue,
      },
    ]);
    console.log("Got validity proof");

    const newAddressParams: NewAddressParams = {
      seed: assetSeed[0],
      addressMerkleTreeRootIndex: proof.rootIndices[0],
      addressMerkleTreePubkey: proof.merkleTrees[0],
      addressQueuePubkey: proof.nullifierQueues[0],
    };

    const outputCompressedAccounts =
      LightSystemProgram.createNewAddressOutputState(
        Array.from(assetAddress.toBytes()),
        program.programId
      );
    const { remainingAccounts: _remainingAccounts } = packCompressedAccounts(
      [],
      [],
      outputCompressedAccounts
    );

    const { newAddressParamsPacked, remainingAccounts } = packNewAddressParams(
      [newAddressParams],
      _remainingAccounts
    );

    const {
      accountCompressionAuthority,
      noopProgram,
      registeredProgramPda,
      accountCompressionProgram,
    } = defaultStaticAccountsStruct();

    const ix = await program.methods
      .createNode(
        {
          a: proof.compressedProof.a,
          b: proof.compressedProof.b,
          c: proof.compressedProof.c,
        },
        newAddressParamsPacked[0].addressMerkleTreeRootIndex,
        Array.from(randomBytes),
        {
          label: "",
          properties: [],
          isMutable: false,
          creators: [],
        }
      )
      .accounts({
        payer: keypair.publicKey,
        updateAuthority: updateAuthority.publicKey,
        owner: recipient.publicKey,
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

    // const lookupTable = (
    //   await connection.getAddressLookupTable(LOOKUP_TABLE_ADDRESS)
    // ).value;
    const blockhash = await connection.getLatestBlockhash();
    const tx = buildAndSignTx(
      [setComputeUnitLimitIx, setComputeUnitPriceIx, ix],
      keypair,
      blockhash.blockhash,
      [updateAuthority]
      // [lookupTable]
    );

    console.log("txSize:", tx.serialize().byteLength);

    const signature = await sendAndConfirmTx(connection, tx, {
      commitment: "confirmed",
    });

    console.log("Your transaction signature", signature);
    console.log("asset id:", assetAddress.toBase58());
    console.log("owner:", recipient.publicKey.toBase58());
  });

  it("can fetch asset and asset metadata by owner", async () => {
    const assets = await connection.getCompressedAccountsByOwner(
      program.programId,
      {
        filters: [
          {
            memcmp: {
              bytes: bs58.encode([1]),
              offset: 0,
            },
          },
          {
            memcmp: {
              bytes: recipient.publicKey.toBase58(),
              offset: 1,
            },
          },
        ],
      }
    );

    const newlyCreatedAsset = assets.items.find((asset) => {
      const decoded: any = borsh.deserialize(assetSchemaV1, asset.data.data);
      const owner = new PublicKey(Uint8Array.from(decoded.owner)).toBase58();
      const isFound = owner === recipient.publicKey.toBase58();
      if (isFound) {
        console.log("asset:", {
          ...decoded,
          owner,
          updateAuthority: new PublicKey(
            Uint8Array.from(decoded.updateAuthority)
          ).toBase58(),
          collectionInfo: {
            assetId: new PublicKey(Uint8Array.from(asset.address)).toBase58(),
            updateAuthority: updateAuthority.publicKey.toBase58(),
          },
        });
      }
      return isFound;
    });

    expect(newlyCreatedAsset).to.not.be.undefined;

    const metadataSeed = await hashToBn254FieldSizeBe(
      Buffer.from([
        2,
        ...program.programId.toBytes(),
        ...newlyCreatedAsset.address,
      ])
    );
    const addressTree = defaultTestStateTreeAccounts().addressTree;
    const metadataAddress = await deriveAddress(metadataSeed[0], addressTree);
    const metadataAccount = await connection.getCompressedAccount(
      bn(metadataAddress.toBytes())
    );
    const metadata: any = borsh.deserialize(
      metadataSchemaV1,
      metadataAccount.data.data
    );
    console.log("metadata:", {
      ...metadata,
      assetId: new PublicKey(Uint8Array.from(metadata.assetId)).toBase58(),
    });
    expect(metadata.uri).to.equal(METADATA_URI);
  });

  const recipient2 = Keypair.generate();
});
