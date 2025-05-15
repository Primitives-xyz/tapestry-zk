import { generateSigner, publicKey, type Umi } from '@metaplex-foundation/umi'
import {
  LightSystemProgram,
  NewAddressParams,
  bn,
  deriveAddress,
  packCompressedAccounts,
  packNewAddressParams,
  deriveAddressSeed,
  addressTree as aT,
  addressQueue as aq,
  merkletreePubkey,
} from '@lightprotocol/stateless.js'
import { createZKConnection } from './zkConnection'
import { PublicKey } from '@solana/web3.js'

export async function setupZKCompression(umi: Umi, program: any) {
  // Generate proper random bytes for node creation
  const randomBytes = generateSigner(umi).secretKey.slice(0, 32)
  const accountKeyNode = Uint8Array.from([0])

  const assetSeed = deriveAddressSeed(
    [accountKeyNode, randomBytes],
    program.programId,
  )
  const addressTree = new PublicKey(aT)
  const addressQueue = new PublicKey(aq)
  const merkleTree = new PublicKey(merkletreePubkey)
  const assetAddress = deriveAddress(assetSeed, addressTree)
  const zkConnection = createZKConnection()
  // Get a fresh proof for the node address using ZK connection
  const proof = await zkConnection.getValidityProofV0(undefined, [
    {
      address: bn(assetAddress.toBytes()),
      tree: addressTree,
      queue: addressQueue,
    },
  ])

  // Create the new address parameters
  const newAddressParams: NewAddressParams = {
    seed: assetSeed,
    addressMerkleTreeRootIndex: proof.rootIndices[0],
    addressMerkleTreePubkey: proof.merkleTrees[0],
    addressQueuePubkey: proof.nullifierQueues[0],
  }

  // Create the output compressed accounts
  const outputCompressedAccounts =
    LightSystemProgram.createNewAddressOutputState(
      Array.from(assetAddress.toBytes()),
      program.programId,
    )

  const { remainingAccounts: _remainingAccounts } = packCompressedAccounts(
    [],
    [],
    outputCompressedAccounts,
    merkleTree,
  )
  const { newAddressParamsPacked, remainingAccounts } = packNewAddressParams(
    [newAddressParams],
    _remainingAccounts,
  )

  return {
    proof,
    randomBytes,
    newAddressParamsPacked,
    remainingAccounts,
    assetAddress,
  }
}
