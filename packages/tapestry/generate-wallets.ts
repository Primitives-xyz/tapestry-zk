import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

// Paths for wallet keys
const walletPaths = [
  "../../keys/GraphU.json",
  "../../keys/provider-wallet.json",
  "../../keys/test/payer.json",
];

// Ensure directories exist
const ensureDirectoryExists = (filePath: string) => {
  const dirname = path.dirname(filePath);
  if (!fs.existsSync(dirname)) {
    fs.mkdirSync(dirname, { recursive: true });
    console.log(`Created directory: ${dirname}`);
  }
};

// Generate wallets that don't exist
let generatedGraphUWallet = false;

walletPaths.forEach((walletPath) => {
  if (!fs.existsSync(walletPath)) {
    console.log(`Wallet not found: ${walletPath}`);
    ensureDirectoryExists(walletPath);

    console.log(`Generating wallet: ${walletPath}`);
    try {
      execSync(
        `solana-keygen new --outfile ${walletPath} --no-bip39-passphrase`,
        { stdio: "inherit" }
      );
      console.log(`Successfully generated wallet: ${walletPath}`);

      if (walletPath === "../../keys/GraphU.json") {
        generatedGraphUWallet = true;
      }
    } catch (error) {
      console.error(`Error generating wallet ${walletPath}:`, error);
    }
  } else {
    console.log(`Wallet already exists: ${walletPath}`);
  }
});

// Display the program ID update notice if GraphU wallet was generated
if (generatedGraphUWallet) {
  try {
    const pubkey = execSync(`solana-keygen pubkey ../../keys/GraphU.json`)
      .toString()
      .trim();
    console.log("\n🔑 New GraphU wallet generated! 🔑");
    console.log("\n⚠️  IMPORTANT: Update Program ID in your codebase ⚠️");
    console.log(
      `\n📝 Replace "GraphUyqhPmEAckWzi7zAvbvUTXf8kqX7JtuvdGYRDRh" with your new program ID:`
    );
    console.log(`\n   👉 ${pubkey}`);
    console.log(`\n🔍 Files that need updating:`);
    console.log(
      `   1. packages/tapestry/programs/tapestry/src/lib.rs - update declare_id!()`
    );
    console.log(`   2. README.md - update Program ID reference`);
    console.log(
      `\n🔎 Run this command to find all occurrences that need updating:`
    );
    console.log(
      `   grep -r "GraphUyqhPmEAckWzi7zAvbvUTXf8kqX7JtuvdGYRDRh" --include="*.{rs,js,ts,md}" .`
    );
  } catch (error) {
    console.error("Error getting pubkey:", error);
  }
}

console.log("Wallet check completed!");
