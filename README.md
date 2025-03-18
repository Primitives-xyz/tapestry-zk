## Installation & Testing

Follow these steps to set up and test the Tapestry protocol:

1. **Clone the repository**:

   ```bash
   git clone https://github.com/Primitives-xyz/tapestry-zk
   cd tapestry-zk
   ```

2. **Install dependencies**:

   ```bash
   bun install
   ```

3. **Run tests**:
   ```bash
   cd packages/tapestry
   bun run test:local
   ```

The `test:local` command performs the following actions:

1. Generates necessary wallets (using `generate-wallets.ts`)
2. Starts a local Solana validator with Light Protocol enabled
3. Airdrops SOL to test wallets
4. Builds the Tapestry program
5. Deploys the program to the local network
6. Runs the test suite

# Tapestry: On-Chain Social Graph Protocol

Tapestry is a protocol for creating and managing on-chain social graphs on the Solana blockchain. It leverages account compression and zero-knowledge proofs to enable efficient and private social connections.

## Overview

Tapestry provides a graph-based data structure for social relationships, where:

- **Nodes**: Represent users, entities, or content with metadata
- **Edges**: Represent relationships and connections between nodes

The protocol uses Light Protocol's account compression system to store social graph data efficiently on-chain while maintaining privacy through zero-knowledge proofs.

## Repository Structure

### Core Protocol

- **Tapestry Program**: The main Solana program for the social graph
  - Location: `packages/tapestry/programs/tapestry/src/lib.rs`
  - Program ID: `GraphUyqhPmEAckWzi7zAvbvUTXf8kqX7JtuvdGYRDRh`

### Program Testing Notes

When you run `bun run test:local`, the system will automatically:

- Generate a new keypair for the program and save it to `keys/GraphU.json`
- Set up all required test wallets
- Start a local validator
- Test the program functionality in a local environment
