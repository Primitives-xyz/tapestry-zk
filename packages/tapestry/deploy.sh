solana program deploy target/deploy/tapestry.so \
  --program-id target/deploy/GraphU.json \
  --keypair target/deploy/keypair.json \
  --fee-payer target/deploy/name.json \
  --with-compute-unit-price 1000 \
  --use-rpc \
  --max-sign-attempts 1000 \
  --url "https://mainnet.helius-rpc.com/?api-key=f30d6a96-5fa2-4318-b2da-0f6d1deb5c83"