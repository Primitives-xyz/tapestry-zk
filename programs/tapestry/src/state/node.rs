use crate::state::AccountKey;
use anchor_lang::prelude::*;
use borsh;
use light_hasher::bytes::AsByteVec;
use light_sdk::light_account;
use light_utils::hash_to_bn254_field_size_be;

// Creator structure for social graph nodes
#[derive(Clone, Copy, Debug, PartialEq, Eq, AnchorSerialize, AnchorDeserialize, Default)]
pub struct Creator {
    pub address: Pubkey,
    pub verified: bool,
    // Share percentage (0-100)
    pub share: u8,
}

impl AsByteVec for Creator {
    fn as_byte_vec(&self) -> Vec<Vec<u8>> {
        let creator_bytes = self.try_to_vec().unwrap();
        let truncated_creator_bytes = hash_to_bn254_field_size_be(&creator_bytes.as_slice())
            .unwrap()
            .0;
        vec![truncated_creator_bytes.to_vec()]
    }
}

// Properties structure for key-value pairs
#[derive(Clone, Debug, PartialEq, Eq, AnchorSerialize, AnchorDeserialize, Default)]
pub struct Properties {
    pub key: String,
    pub value: String,
}

impl AsByteVec for Properties {
    fn as_byte_vec(&self) -> Vec<Vec<u8>> {
        let properties_bytes = self.try_to_vec().unwrap();
        let truncated_properties_bytes = hash_to_bn254_field_size_be(&properties_bytes.as_slice())
            .unwrap()
            .0;
        vec![truncated_properties_bytes.to_vec()]
    }
}

// Wrapper for Vec<Properties>
#[derive(Clone, Debug, Default)]
pub struct PropertiesVec(pub Vec<Properties>);

impl AsByteVec for PropertiesVec {
    fn as_byte_vec(&self) -> Vec<Vec<u8>> {
        let properties_bytes = self.0.try_to_vec().unwrap();
        let truncated_properties_bytes = hash_to_bn254_field_size_be(&properties_bytes.as_slice())
            .unwrap()
            .0;
        vec![truncated_properties_bytes.to_vec()]
    }
}

// Wrapper for Vec<Creator>
#[derive(Clone, Debug, Default)]
pub struct CreatorsVec(pub Vec<Creator>);

impl AsByteVec for CreatorsVec {
    fn as_byte_vec(&self) -> Vec<Vec<u8>> {
        let creators_bytes = self.0.try_to_vec().unwrap();
        let truncated_creators_bytes = hash_to_bn254_field_size_be(&creators_bytes.as_slice())
            .unwrap()
            .0;
        vec![truncated_creators_bytes.to_vec()]
    }
}

// NodeArgs structure for creating social graph nodes
#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Eq, Debug, Clone)]
pub struct NodeArgs {
    /// The label of the node
    pub label: String,
    // key value pair of properties
    pub properties: Vec<Properties>,
    // Whether or not the data struct is mutable, default is not
    pub is_mutable: bool,
    pub creators: Vec<Creator>,
}

// NodeData structure to store properties and creators as serialized bytes
#[derive(Clone, Debug, Default, AnchorSerialize, AnchorDeserialize)]
pub struct NodeData {
    pub properties_bytes: Vec<u8>,
    pub creators_bytes: Vec<u8>,
}

impl NodeData {
    pub fn new(properties: &Vec<Properties>, creators: &Vec<Creator>) -> Self {
        Self {
            properties_bytes: properties.try_to_vec().unwrap(),
            creators_bytes: creators.try_to_vec().unwrap(),
        }
    }

    pub fn get_properties(&self) -> Vec<Properties> {
        borsh::BorshDeserialize::deserialize(&mut self.properties_bytes.as_slice())
            .unwrap_or_default()
    }

    pub fn get_creators(&self) -> Vec<Creator> {
        borsh::BorshDeserialize::deserialize(&mut self.creators_bytes.as_slice())
            .unwrap_or_default()
    }
}

impl AsByteVec for NodeData {
    fn as_byte_vec(&self) -> Vec<Vec<u8>> {
        let node_data_bytes = self.try_to_vec().unwrap();
        let truncated_node_data_bytes = hash_to_bn254_field_size_be(&node_data_bytes.as_slice())
            .unwrap()
            .0;
        vec![truncated_node_data_bytes.to_vec()]
    }
}

// The actual Node account structure
#[light_account]
#[derive(Clone, Debug, Default)]
pub struct NodeV1 {
    pub key: AccountKey,
    #[truncate]
    pub owner: Pubkey,
    pub update_authority: UpdateAuthority,
    pub label: String,
    pub node_data: NodeData,
    pub is_mutable: bool,
    pub initialized_plugins: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, AnchorSerialize, AnchorDeserialize, Default)]
pub enum UpdateAuthority {
    #[default]
    None,
    Address(Pubkey),
}

impl UpdateAuthority {
    pub fn as_byte_vec(&self) -> Vec<Vec<u8>> {
        let update_authority_bytes = self.try_to_vec().unwrap();
        let truncated_update_authority_bytes =
            hash_to_bn254_field_size_be(&update_authority_bytes.as_slice())
                .unwrap()
                .0;
        vec![truncated_update_authority_bytes.to_vec()]
    }
}
