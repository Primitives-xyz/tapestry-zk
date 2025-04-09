use crate::state::node::UpdateAuthority;
use crate::state::{AccountKey, Properties};
use anchor_lang::prelude::*;
use borsh;
use light_hasher::bytes::AsByteVec;
use light_sdk::light_account;
use light_utils::hash_to_bn254_field_size_be;

// EdgeArgs structure for creating social graph edges
#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Eq, Debug, Clone)]
pub struct EdgeArgs {
    /// The source node of the edge
    pub source_node: String,
    /// The target node of the edge
    pub target_node: String,
    /// Properties of the edge
    pub properties: Vec<Properties>,
    /// Whether or not the edge is mutable
    pub is_mutable: bool,
}

// EdgeData structure to store properties as serialized bytes
#[derive(Clone, Debug, Default, AnchorSerialize, AnchorDeserialize)]
pub struct EdgeData {
    pub properties_bytes: Vec<u8>,
}

impl EdgeData {
    pub fn new(properties: &Vec<Properties>) -> Self {
        Self {
            properties_bytes: properties.try_to_vec().unwrap(),
        }
    }

    pub fn get_properties(&self) -> Vec<Properties> {
        borsh::BorshDeserialize::deserialize(&mut self.properties_bytes.as_slice())
            .unwrap_or_default()
    }
}

impl AsByteVec for EdgeData {
    fn as_byte_vec(&self) -> Vec<Vec<u8>> {
        let edge_data_bytes = self.try_to_vec().unwrap();
        let truncated_edge_data_bytes = hash_to_bn254_field_size_be(&edge_data_bytes.as_slice())
            .unwrap()
            .0;
        vec![truncated_edge_data_bytes.to_vec()]
    }
}

// Edge structure to represent connections between nodes
#[light_account]
#[derive(Clone, Debug, Default)]
pub struct EdgeV1 {
    pub key: AccountKey,
    #[truncate]
    pub source_node: String,
    #[truncate]
    pub target_node: String,
    pub edge_data: EdgeData,
    pub is_mutable: bool,
    pub owner: Pubkey,
    pub update_authority: UpdateAuthority,
    pub initialized_plugins: u16,
}
