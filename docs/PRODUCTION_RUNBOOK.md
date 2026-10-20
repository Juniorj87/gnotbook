# Production runbook

1. `npm ci` and `npm test`.
2. Configure `.env` with RPC, chain ID, public treasury, registry path, server-side `OCTOPIN_API_KEY` and a random admin token. Never store wallet secrets.
3. Deploy/compile/audit the on-chain registry and collection source on Onyx first. Confirm the registry fee sink equals the `.env` treasury.
4. Run `npm run pin:octopin`; it verifies the CIDs and writes the two `ipfs://` bases to `.env`; restart.
5. Connect Adena on the same network; deploy the registry if required, then update `MORROW_REGISTRY_PATH` after confirmation.
6. Launch GNO PUNK once; wait for successful confirmation and verify `ListCollections`, `FeaturedCollection`, supply, mint price and IPFS URIs directly via the chain/explorer.
7. Test mint/list/buy/cancel and confirm each balance delta and item owner on chain. Verify the buyer pays ask + 2.5%, the seller receives ask less royalty, the creator receives royalty, and treasury receives the fee.
8. Enable TLS, process manager/health monitoring, PostgreSQL with backup for multi-instance deployments, and token rotation. Do not publicly expose `/admin` beyond operators.
9. Enable mainnet writes only after an independent contract review. Keep rollback/incident response and treasury monitoring ready.
