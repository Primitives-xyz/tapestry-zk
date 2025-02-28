import { Program } from "@coral-xyz/anchor";
import * as idl from "../target/idl/tapestry.json";
import * as anchor from "@coral-xyz/anchor";
import { Tapestry } from "../target/types/tapestry";
import metadatas from "./collection/formatted-metadata.json";
import fs from "fs";
import { BlobUploader } from "./blob-uploader";

const keypair = anchor.web3.Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(
      fs.readFileSync(
        __dirname + "/../target/deploy/authority-keypair.json",
        "utf-8"
      )
    )
  )
);

const program = new Program(
  idl as unknown as Tapestry,
  "GraphUyqhPmEAckWzi7zAvbvUTXf8kqX7JtuvdGYRDRh",
  {
    // connection: new anchor.web3.Connection("http://localhost:8899"),
    connection: new anchor.web3.Connection(
      "https://zk-testnet.helius.dev:8899"
    ),
  }
);

const metadatasSlice = metadatas;
(async () => {
  const signatures = [];
  for (let i = 0; i < metadatasSlice.length; i++) {
    console.log(`Uploading metadata ${i + 1} of ${metadatasSlice.length}`);
    const metadata = metadatasSlice[i];
    const blobUploader = new BlobUploader(
      program,
      keypair,
      Buffer.from(JSON.stringify(metadata)),
      true
    );
    const signature = await blobUploader.uploadBlob();
    signatures.push(signature);
    fs.writeFileSync(
      __dirname + "/testnet-blobs.json",
      JSON.stringify(signatures, null, 2)
    );
  }
})();
