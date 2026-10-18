# Morrow Marketplace — Test Report

## Automated

- `npm run check`: syntax check of `server.mjs`, `public/app.js`, `public/admin.js`, `scripts/preflight.mjs`, `scripts/pin-nft-collection.mjs` — PASS.
- `npm run preflight`: 1111 images + 1111 metadata, JSON valid, image signatures, hashes, fee constants, no obsolete third-party deps — PASS.
- `npm run test:unit`: 8 tests — PASS (healthz, config secrets, traits 1111/7 groups, traits 404, realm-read restriction x2, collection-items 400, market shape, sale-total math).

## Browser (manual, this session)

- All routes render distinct pages; 0 console errors; 0 failed requests.
- Wallet modal, favorite persistence (`localStorage ["0003"]`), locked tile → item page verified.
- Faked-market buy flow: `saleTotal` totals correct; checkout modal shows `10.25 GNOT`; confirm-buy reaches `sendTx` → "Connect Adena before signing a transaction."
- Collection page: facets (7 groups, 77 checkboxes), sort, tabs, rarity distribution verified against raw metadata files.
- Item page: 7 real traits from `metadata/0024.json`; art stays locked for unminted edition.
- Creator studio: launch-cost and launch-rules panels render; honest disabled states.

## Not tested

- Gno contract compilation (no toolchain in environment).
- On-chain mint/buy/cancel (no deployed realm, no funded wallet).
- IPFS pinning with real CIDs (no `PINATA_JWT`).
- PostgreSQL path (no DB instance).
- Offers/auctions (not implemented).

## Commands

```
npm ci
npm test
npm start
```
