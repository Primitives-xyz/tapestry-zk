pub mod constants;
pub mod errors;
pub mod processor;
pub mod state;
pub mod utils;

use anchor_lang::prelude::*;
use processor::*;
use state::*;

declare_id!("GraphUyqhPmEAckWzi7zAvbvUTXf8kqX7JtuvdGYRDRh");

#[program]
pub mod tapestry {
    use super::*;

    pub fn create_node<'info>(
        ctx: Context<'_, '_, '_, 'info, CreateNode<'info>>,
        proof: AnchorCompressedProof,
        address_merkle_tree_root_index: u16,
        random_bytes: [u8; 32],
        node_args: NodeArgs,
    ) -> Result<()> {
        processor::create_node(
            ctx,
            proof,
            address_merkle_tree_root_index,
            random_bytes,
            node_args,
        )
    }

    pub fn create_edge<'info>(
        ctx: Context<'_, '_, '_, 'info, CreateEdge<'info>>,
        proof: AnchorCompressedProof,
        address_merkle_tree_root_index: u16,
        random_bytes: [u8; 32],
        edge_args: EdgeArgs,
    ) -> Result<()> {
        processor::create_edge(
            ctx,
            proof,
            address_merkle_tree_root_index,
            random_bytes,
            edge_args,
        )
    }
}
