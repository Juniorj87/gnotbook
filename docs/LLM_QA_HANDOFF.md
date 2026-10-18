# Browser QA hand-off (for a coding assistant)

## Objective
Run and inspect the actual Morrow web application, fix bugs directly in the project, and return a concise report plus updated files. Do not merely review the source or give recommendations.

## Correct launch flow
1. Use Node.js 20+ and npm.
2. In the project root, copy `.env.example` to `.env` if missing.
3. Run `npm install` (network access is required on the first run).
4. Run `npm run check` and `npm run preflight`.
5. Run `npm start` and open `http://127.0.0.1:4173` in a real browser. Do not treat root `index.html` as the live application: it is a static style preview. `public/index.html` is served by Express.
6. Open browser DevTools Console and Network. Check for JavaScript exceptions, 404s, blocked CSP requests, malformed RPC requests, broken images, overflow and failed APIs.

## Read-only smoke checks
- `GET /api/config`: reports chain id, RPC status, factory path, fee values and whether transaction/pinning services are enabled. Never expose secrets.
- `GET /api/health`: reports RPC availability and persistence mode.
- `GET /api/market`: returns live-read collections/listings or a clear read error.
- Open Explore, Collections, Activity, Rewards and Portfolio. Verify empty/error states are understandable and do not fabricate sales/holders/prices.
- Inspect `index.html` by double-clicking: it should still be styled and explain that wallet/RPC actions require the local server.
- Confirm the app never asks for or stores a seed phrase/private key. Confirm no `PINATA_JWT`, admin token or database URL is sent to the browser.

## Wallet and transaction tests
- Start with a dedicated test wallet and a testnet where relevant contracts exist. Confirm Adena extension availability, account address parsing, chain ID, cancellation/rejection handling and wrong-network messaging.
- Do not approve a transaction unless realm path, method, NFT id, receiver, price, platform fee and protocol/royalty behavior are independently understood.
- Do not enable `GNOLAND_MAINNET_TRADING_ENABLED` just to get past a UI gate. Do not run a purchase, mint, listing or collection deployment with real funds during smoke tests.
- To call a flow complete, provide the transaction hash and independently verify the final confirmed transaction and resulting ownership on chain. `broadcast_tx_sync` acceptance alone is not success; check the final `tx_result`.
- Contract templates must compile with the target Gno toolchain and pass tests before any public deployment. Do not make up compilation/audit/test results.

## Required output from the QA agent
1. Files changed and why.
2. Commands actually run and their exit statuses.
3. Browser checks actually performed (screenshots are helpful).
4. Bugs fixed and any remaining blockers, separated into UI, RPC, Adena, IPFS, contract and security.
5. Exact checks that were not possible; never label the app production-ready if contract compilation, on-chain transaction tests and security review were not done.
