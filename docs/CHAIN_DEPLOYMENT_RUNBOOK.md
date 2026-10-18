# Morrow Marketplace — Chain Deployment Runbook

## Prerequisites

- Official Gno toolchain (install separately; not present in this environment).
- Funded testnet wallet (Onyx) with enough GNOT for gas + 2,000 GNOT launch fee.
- `MORROW_ADMIN_TOKEN`, `PINATA_JWT`, treasury address.

## Steps

1. Compile `contracts/registry/morrowmarket.gno` and the generated `contracts/templates/morrow-collection.gno` with the official Gno toolchain. Fix any compile errors before proceeding.
2. Run contract tests (supply, mint price, fee, royalty, double-mint, unauthorized cancel, underpayment).
3. Deploy the registry to Onyx; record the realm path.
4. Set `MORROW_REGISTRY_PATH=<realm path>` in `.env`; set `GNOLAND_CHAIN_ID=onyx-1`, `GNOLAND_RPC_URL=https://rpc.onyx.testnets.gno.land:443`, `GNOLAND_ONYX_TRADING_ENABLED=true`.
5. Restart server; confirm `/api/config` shows `registryCompatible: true`.
6. Pin Moonbound assets: `npm run pin:moonbound`; set `MOONBOUND_IMAGE_BASE_URI` and `MOONBOUND_METADATA_BASE_URI`; restart.
7. Launch Moonbound Keepers from Creator Studio; sign the 2,000 GNOT launch + gas in Adena.
8. Verify the collection appears in `/api/market` and the featured banner updates.
9. Mint one edition (575 GNOT), list it, buy it with a second wallet, cancel a listing, check owner change and fee routing.
10. Inspect every transaction on the explorer before enabling mainnet.

## Mainnet

Do not enable `GNOLAND_MAINNET_TRADING_ENABLED=true` until the Onyx lifecycle passes and an independent security review is complete. Never publish mainnet contracts or sign irreversible transactions without owner confirmation.
