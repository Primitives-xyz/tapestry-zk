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
