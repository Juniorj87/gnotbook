# Morrow Marketplace — Architecture

## Runtime topology

- `server.mjs` is the single Node.js process: Express 5, Helmet, rate limits, multer uploads, static file serving.
- `public/` is the SPA: `index.html` + `app.js` + `admin.html`/`admin.js` + `styles.css`. No build step; scripts are served as-is.
- `nft-collection/` holds the pinned local assets (images, metadata, manifest) and is mounted at `/collection-assets`.
- `contracts/` holds Gno source: `registry/morrowmarket.gno` and `templates/morrow-collection.gno`.
- `data/store.json` (or PostgreSQL via `DATABASE_URL`) holds mutable app state: reports, moderation, points, verified paths.

## Data flow

1. Frontend calls `/api/config` and `/api/market` on load.
2. `/api/market` queries the on-chain registry (`REGISTRY_PATH`) via Gno ABCI `vm/qeval_json`, then reads each registered collection realm (`Name`, `MaxSupply`, `Minted`, `MintPrice`, `ListOpen`, …).
3. The chain is the source of truth for ownership, supply, listings and fees. The DB/file store is a search/moderation cache and is never trusted for ownership.
4. IPFS uploads go through `POST /api/ipfs/*`, which uses the server-side `PINATA_JWT`; the browser never sees the token.

## Key modules

- `server.mjs`: config, RPC helpers (`rpc`, `abciQuery`, `evalValue`), `readCollection`, `getCollections`, `getMarket`, store, admin auth, routes, IPFS proxy.
- `public/app.js`: routing via `data-route` → `routeTo()`; click delegation; wallet integration (`adena`); transaction builders (`transactionMessage`, `sendTx`); rendering functions per screen.
- `contracts/registry/morrowmarket.gno`: registry (`Init`, `Register`, `CreditLaunchFee`, `LaunchFee`, `MarketplaceFeeBps`, `FeaturedCollection`, `ListCollections`).
- `contracts/templates/morrow-collection.gno`: collection realm (`Init`, `PublicMint`, `Mint`, `List`, `Buy`, `Cancel`, `ItemLine`/`ItemLines`).

## Security boundaries

- `/api/realm-read` is restricted to registered Morrow collections and an allowlist of read-only getters.
- Admin endpoints require `MORROW_ADMIN_TOKEN` via `adminAuth` (timing-safe compare).
- Writes are disabled unless `GNOLAND_*_TRADING_ENABLED=true` and the registry fee model matches.
- Multer: one file, 15 MB max, PNG/JPEG/WEBP/GIF only; write limiter 30/min; general limiter 240/min.
- CSP via Helmet; `x-powered-by` disabled; trust proxy off unless `TRUST_PROXY=true`.

## Known gaps

- No Gno toolchain is available in this environment, so contract compilation is unverified here.
- No PostgreSQL instance is provisioned by default; JSON store is used.
- Offers and auctions are not implemented on-chain; CTAs are disabled/absent.
- No hash/deep-link routing; navigation is click-driven.
