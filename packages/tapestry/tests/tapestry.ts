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
import { expect, describe, it } from "bun:test";
import { Connection, Keypair } from "@solana/web3.js";
import idl from "../target/idl/tapestry.json";
import * as borsh from "borsh";

import "dotenv/config";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import { assetSchemaV1, metadataSchemaV1 } from "../src";

const { PublicKey } = anchor.web3;

const keypair = anchor.web3.Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(fs.readFileSync("target/deploy/name.json", "utf-8"))
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
      new anchor.Wallet(keypair),
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

  it("Can create compressed account", async () => {
    const seed = Keypair.generate().publicKey.toBytes();

    const txSig = await createAccount(
      connection,
      keypair,
      seed,
      program.programId,
      undefined,
      undefined,
      undefined
    );
  });

  const LOOKUP_TABLE_ADDRESS = // new PublicKey("Dh74qoNrgMYzk4ZFZenKS2f9gSA9AqXrcgYzyBia1r3W") // prod lookup table
    new PublicKey("3UQtx7pqXu2jZADF8YW3uaFq7EzASs55rZzxSRCibqb7"); // dev lookup table

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

  it("Can create asset", async () => {
    const addressTree = defaultTestStateTreeAccounts().addressTree;
    const addressQueue = defaultTestStateTreeAccounts().addressQueue;

    const assetSeed = await hashToBn254FieldSizeBe(
      Buffer.from([1, ...program.programId.toBytes(), ...randomBytes])
    );
    const assetAddress = await deriveAddress(assetSeed[0], addressTree);

    const metadataSeed = await hashToBn254FieldSizeBe(
      Buffer.from([
        2,
        ...program.programId.toBytes(),
        ...assetAddress.toBytes(),
      ])
    );

    const metadataAddress = await deriveAddress(metadataSeed[0], addressTree);

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
          label: "test",
          properties: [
            {
              key: "test",
              value: "test",
            },
          ],
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
  });

  const recipient2 = Keypair.generate();
});
