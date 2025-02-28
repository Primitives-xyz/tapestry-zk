use anchor_lang::prelude::*;
use light_hasher::bytes::AsByteVec;
use light_utils::hash_to_bn254_field_size_be;

pub use anchor_compressed_proof::*;
pub use edge::*;
pub use node::*;

// Explicitly re-export the UpdateAuthority types with different names
pub use node::UpdateAuthority as NodeUpdateAuthority;

mod anchor_compressed_proof;
mod edge;
mod node;

#[derive(Clone, Copy, Debug, PartialEq, Eq, AnchorSerialize, AnchorDeserialize, Default)]
#[repr(u8)]
pub enum AccountKey {
    #[default]
    NodeV1,
    EdgeV1,
}

impl AsByteVec for AccountKey {
    fn as_byte_vec(&self) -> Vec<Vec<u8>> {
        let account_key_bytes = self.try_to_vec().unwrap();
        let truncated_account_key_bytes =
            hash_to_bn254_field_size_be(&account_key_bytes.as_slice())
                .unwrap()
                .0;
        vec![truncated_account_key_bytes.to_vec()]
    }
}
