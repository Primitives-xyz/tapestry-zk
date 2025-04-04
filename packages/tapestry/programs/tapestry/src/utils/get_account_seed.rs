use anchor_lang::prelude::*;
use light_utils::hashv_to_bn254_field_size_be;

use crate::AccountKey;

pub fn get_account_seed(account_key: AccountKey, asset_id: &[u8; 32]) -> [u8; 32] {
    let account_key_bytes = account_key.try_to_vec().unwrap();
    let account_type_bytes: &[u8] = &[account_key_bytes[0]];
    let input = [&crate::ID.to_bytes(), account_type_bytes, asset_id].concat();
    hashv_to_bn254_field_size_be(&[&input])
}
