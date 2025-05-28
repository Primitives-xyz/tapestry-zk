use crate::constants::CPI_AUTHORITY_SEED;
use crate::errors::ZkNftError;
use crate::state::{AccountKey, EdgeArgs, EdgeData, EdgeV1, NodeUpdateAuthority};
use crate::utils::validate_merkle_trees;
use crate::utils::{get_account_seed, new_compressed_account};
use crate::AnchorCompressedProof;
use anchor_lang::prelude::*;
use light_sdk::merkle_context::{PackedAddressMerkleContext, PackedMerkleOutputContext};
use light_sdk::proof::CompressedProof;
use light_sdk::utils::create_cpi_inputs_for_new_account;
use light_sdk::verify::verify;
use light_sdk::{light_system_accounts, LightTraits};

pub fn create_edge<'info>(
    ctx: Context<'_, '_, '_, 'info, CreateEdge<'info>>,
    proof: AnchorCompressedProof,
    address_merkle_tree_root_index: u16,
    random_bytes: [u8; 32],
    edge_args: EdgeArgs,
) -> Result<()> {
    let merkle_output_context = PackedMerkleOutputContext {
        merkle_tree_pubkey_index: 0,
    };
    let address_merkle_context = PackedAddressMerkleContext {
        address_merkle_tree_pubkey_index: 1,
        address_queue_pubkey_index: 2,
    };
    // msg!("proof at start of create_edge: {:?}", proof);
    validate_merkle_trees(0, Some(1), Some(2), None, ctx.remaining_accounts)?;

    // Validate that source and target nodes are different
    if edge_args.source_node == edge_args.target_node {
        return Err(error!(ZkNftError::SelfReferenceNotAllowed));
    }

    // Create the edge data from properties
    let edge_data = EdgeData::new(&edge_args.properties);

    // Create the edge
    let edge = EdgeV1 {
        key: AccountKey::EdgeV1,
        source_node: edge_args.source_node,
        target_node: edge_args.target_node,
        edge_data,
        is_mutable: edge_args.is_mutable,
        owner: ctx.accounts.owner.key(),
        update_authority: match &ctx.accounts.update_authority {
            Some(update_authority) => NodeUpdateAuthority::Address(update_authority.key()),
            None => NodeUpdateAuthority::None,
        },
        initialized_plugins: 0,
    };

    let edge_seed = get_account_seed(AccountKey::EdgeV1, &random_bytes);
    let (edge_compressed_account, edge_new_address_params) = new_compressed_account(
        &edge,
        &edge_seed,
        &crate::ID,
        &merkle_output_context,
        &address_merkle_context,
        address_merkle_tree_root_index,
        ctx.remaining_accounts,
    )?;

    let bump = ctx.bumps.cpi_authority_pda;
    let signer_seeds = [CPI_AUTHORITY_SEED.as_bytes(), &[bump]];

    // msg!("proof: {:?}", proof);
    // Create account
    let cpi_inputs = create_cpi_inputs_for_new_account(
        CompressedProof {
            a: proof.a,
            b: proof.b,
            c: proof.c,
        },
        edge_new_address_params,
        edge_compressed_account,
        None,
    );
    // msg!("cpi_inputs: {:?}", cpi_inputs);

    verify(&ctx, &cpi_inputs, &[&signer_seeds])?;

    Ok(())
}

#[light_system_accounts]
#[derive(Accounts, LightTraits)]
pub struct CreateEdge<'info> {
    #[account(mut)]
    #[fee_payer]
    pub payer: Signer<'info>,
    pub update_authority: Option<Signer<'info>>,
    /// CHECK: This can be any valid public key.
    pub owner: UncheckedAccount<'info>,

    /// CHECK: Checked in light-system-program.
    #[authority]
    #[account(
        seeds = [CPI_AUTHORITY_SEED.as_bytes()],
        bump
    )]
    pub cpi_authority_pda: UncheckedAccount<'info>,
    #[self_program]
    pub self_program: Program<'info, crate::program::Tapestry>,
}
