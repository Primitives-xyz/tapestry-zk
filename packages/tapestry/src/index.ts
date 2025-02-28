import idl from "../target/idl/zk_nft.json";
import stakeIdl from "../target/idl/stake.json";

// main program
export type { Tapestry } from "../target/types/tapestry";
export { idl };
export const PROGRAM_ID = "GraphUyqhPmEAckWzi7zAvbvUTXf8kqX7JtuvdGYRDRh";
export { getDelegateRoleFromNumber, getBaseDataStateFromNumber } from "./utils";
export {
  assetSchemaV1,
  metadataSchemaV1,
  stakeRecordSchemaV1,
  freezeDelegateSchemaV1,
} from "./schemas";

export type { Stake } from "../target/types/stake";
export { stakeIdl };
export const STAKE_PROGRAM_ID = "stk3g78wHcLTHgAqedaaxpqAvaDDRkxFj4qY4ew3CG4";
