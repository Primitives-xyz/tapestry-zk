use crate::constants::CPI_AUTHORITY_SEED;
use crate::state::{AccountKey, NodeArgs, NodeData, NodeUpdateAuthority, NodeV1};
use crate::utils::validate_merkle_trees;
use crate::utils::{get_account_seed, new_compressed_account};
use crate::AnchorCompressedProof;
use anchor_lang::prelude::*;
use light_sdk::merkle_context::{PackedAddressMerkleContext, PackedMerkleOutputContext};
use light_sdk::proof::CompressedProof;
use light_sdk::utils::create_cpi_inputs_for_new_account;
use light_sdk::verify::verify;
use light_sdk::{light_system_accounts, LightTraits};

pub fn create_node<'info>(
    ctx: Context<'_, '_, '_, 'info, CreateNode<'info>>,
    proof: AnchorCompressedProof,
    address_merkle_tree_root_index: u16,
    random_bytes: [u8; 32],
    node_args: NodeArgs,
) -> Result<()> {
    let merkle_output_context = PackedMerkleOutputContext {
        merkle_tree_pubkey_index: 0,
    };
    let address_merkle_context = PackedAddressMerkleContext {
        address_merkle_tree_pubkey_index: 1,
        address_queue_pubkey_index: 2,
    };
    validate_merkle_trees(0, Some(1), Some(2), None, ctx.remaining_accounts)?;

    // Create the node data from properties and creators
    let node_data = NodeData::new(&node_args.properties, &node_args.creators);

    // Create the node
    let node = NodeV1 {
        key: AccountKey::NodeV1,
        owner: ctx.accounts.owner.key(),
        update_authority: match &ctx.accounts.update_authority {
            Some(update_authority) => NodeUpdateAuthority::Address(update_authority.key()),
            None => NodeUpdateAuthority::None,
        },
        label: node_args.label,
        node_data,
        is_mutable: node_args.is_mutable,
        initialized_plugins: 0,
    };

    let node_seed = get_account_seed(AccountKey::NodeV1, &random_bytes);
    let (node_compressed_account, node_new_address_params) = new_compressed_account(
        &node,
        &node_seed,
        &crate::ID,
        &merkle_output_context,
        &address_merkle_context,
        address_merkle_tree_root_index,
        ctx.remaining_accounts,
    )?;

    let bump = ctx.bumps.cpi_authority_pda;
    let signer_seeds = [CPI_AUTHORITY_SEED.as_bytes(), &[bump]];

    // Create account
    let cpi_inputs = create_cpi_inputs_for_new_account(
        CompressedProof {
            a: proof.a,
            b: proof.b,
            c: proof.c,
        },
        node_new_address_params,
        node_compressed_account,
        None,
    );

    verify(&ctx, &cpi_inputs, &[&signer_seeds])?;

    Ok(())
}

#[light_system_accounts]
#[derive(Accounts, LightTraits)]
pub struct CreateNode<'info> {
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
