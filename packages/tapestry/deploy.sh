solana program deploy target/deploy/tapestry.so \
  --program-id ../../keys/GraphU.json \
  --keypair ../../keys/keypair.json \
  --fee-payer ../../keys/provider-wallet.json \
  --with-compute-unit-price 1000 \
  --use-rpc \
  --max-sign-attempts 1000 \
  --url "https://devnet.helius-rpc.com/?api-key=f30d6a96-5fa2-4318-b2da-0f6d1deb5c83"