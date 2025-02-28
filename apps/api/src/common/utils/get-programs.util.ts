import { PROGRAM_ID, Tapestry, idl } from "@tapestry/program";
import { Rpc } from "@lightprotocol/stateless.js";
import { Keypair } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";

export const getZkNftProgram = (rpc: Rpc) => {
  const EPHEMERAL_KEYPAIR = Keypair.generate();
  const provider: AnchorProvider = new AnchorProvider(
    rpc,
    {
      publicKey: EPHEMERAL_KEYPAIR.publicKey,
      signAllTransactions: (transactions) => Promise.resolve(transactions),
      signTransaction: (transaction) => Promise.resolve(transaction),
    },
    { commitment: "confirmed" }
  );
  const program = new Program<Tapestry>(idl as any, PROGRAM_ID, provider);
  return program;
};
