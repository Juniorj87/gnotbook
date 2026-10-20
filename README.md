# Gnotbook — NFT marketplace for Gno.land

Gnotbook is an independent marketplace and launchpad for NFT collections on the Gno.land chain. It ships
with its own on-chain registry and collection template, wallet-signed Adena transactions, IPFS-pinned
artwork and a moderation desk. It does not depend on another marketplace's registry or fee system.

The public brand is **Gnotbook**; the on-chain contracts and the treasury keep the **Morrow** name.

- **Live:** https://gnotbook.vercel.app
- **Source:** https://github.com/Juniorj87/gnotbook

---

## What it does

| Surface | What it is for |
|---|---|
| **Explore** | Hero slider of live collections, the next mints on the schedule, the creator shelf. |
| **Upcoming Mints** | Every collection with a mint start time, with a live countdown computed from real time. |
| **Collections** | The public catalog of registered collections. |
| **Market** | Live asks read from each collection realm, plus a curated list of chains the server surfaces. |
| **Portfolio** | The connected wallet's native balance, its tokens in known realms, and its own collections. |
| **Creator studio** | Save a collection draft server-side, then optionally deploy its realm on-chain. |
| **Quests & points** | Reputation earned from confirmed on-chain actions. |
| **Settings** | Profile, wallet and the live server configuration. |

## How it works

### 1. Read path — the server is a reader, not a keeper

The backend never holds keys and never custodies an NFT. Everything a visitor sees is read from the chain
or from a small server-owned store:

- **Catalog** — the union of three sources: the server's own store (drafts saved by creators), the
  on-chain registry (`ListCollections` on the registry realm) and the paths the moderation team has verified.
- **Balances** — `bank/balances/<address>` over ABCI. The public RPC answers with a bare
  `"<amount><denom>"` string, so the response is normalised in `parseBalances()` before it reaches the UI.
- **Holdings** — for every realm the server knows about (the pinned collection, the external projects and
  the public catalog) it reads `BalanceOf` and walks `TokenOfOwnerByIndex`, then resolves `TokenURI` into
  metadata. Token ids are passed as **quoted strings**: the realm signature is `TokenURI(id string)`, and a
  bare `TokenURI(314)` is a number literal that the realm silently ignores.
- **Listings** — `ListOpen()` on each collection realm, parsed from the realm's own record format.
- **Supply, royalties, fees** — read from the contracts, never estimated.

### 2. Write path — the wallet signs, the server never does

The browser talks to Adena (Gno.land) or Keplr (AtomOne) directly. The server only builds the unsigned
transaction messages; the wallet signs them and the network confirms them. A private key or seed phrase is
never requested, transmitted or stored.

Write operations are gated three times over:

- a network flag (`GNOLAND_MAINNET_TRADING_ENABLED` / `GNOLAND_ONYX_TRANSACTIONS_ENABLED`),
- a configured treasury and registry,
- the registry's own fee model, which the server verifies before it trusts the registry.

### 3. The registry and the fee model

- **Launch fee**: 5 GNOT per on-chain collection deploy, settled to the fee sink inside the registry contract.
- **Secondary sale**: the buyer pays the ask **plus 2.5%**, and the contract splits seller, royalty and the
  platform fee in the same transaction. The server rejects any registry whose fee model does not match.
- **Creator royalty**: set at deployment (2% by default), paid by the seller side, capped at 10%.
- **Founder reserve**: a fixed number of editions is minted to the public founder address at launch, for gas only.
  The count lives in the contract, not in a metadata flag.

### 4. Artwork and metadata — the creator pins it, the server never holds a key

Artwork and metadata are pinned to IPFS (content-addressed, immutable). **The creator does the pinning**,
in their own Pinata or Octopin account, and hands over the CIDs:

- the create form and the item-mint form offer two routes — *"I pinned it myself"* (the default) and
  *"Upload here"* for deployments that run their own pinning credential;
- the self-service route links straight to [app.pinata.cloud](https://app.pinata.cloud/) and
  [octopin.app](https://octopin.app/) with the exact steps, including the Octopin upload endpoint
  (`POST https://upload.octopin.app/api/upload`) for scripted uploads;
- `POST /api/ipfs/verify` resolves a CID on the public gateways (Octopin, Pinata, ipfs.io) and reports
  what is behind it: a parsed metadata JSON, an image with its size, or a folder with a hint. Reading a
  public gateway needs no credential;
- a CID may point at a file inside a folder (`bafy…/0001.json`), which is how a creator references one
  edition of a pinned collection;
- the collection record then carries the creator's `imageBaseURI` and `metadataBaseURI`, and the on-chain
  `Init` call receives exactly those bases.

The server only ever *reads* what the creator pinned. It never receives a storage key, so a public
deployment can host creators without spending the operator's storage quota.

### 5. Allowlist (whitelist) handling

A creator uploads a list of `g1…` addresses (TXT, CSV or JSON). The server validates the format, de-duplicates,
counts them and stores them **server-side only**. The public API exposes the *count* and a boolean, never the
addresses. The on-chain allowlist gate is marked in the UI as preparation-only until the collection realm
supports allowlist proofs — the server does not pretend to enforce something the contract does not.

### 6. Storage

Artwork and metadata are pinned to IPFS (Octopin or Pinata, configurable); the pinned CIDs and their
checksums are verified before they are written into the collection metadata. The server's own store holds
only small, non-custodial records (drafts, points, upload counters, allowlist counts) — it can be a local
JSON file or Postgres via `DATABASE_URL`.

### 7. Frontend

A dependency-free single-page app: one HTML shell, one stylesheet, one JavaScript module. No build step, no
framework, no bundler — the browser loads the files as they are, and the server serves them as static assets
with ETag caching. Routing is hash-based (`#explore`, `#collection?path=…`), so every deep link survives a
refresh and a static host.

The UI is described in [docs/DESIGN.md](docs/DESIGN.md); the system internals in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); the chain-side rules in [docs/ON-CHAIN.md](docs/ON-CHAIN.md).

### 8. Checks

- `npm test` — static analysis, a source preflight (asset counts, pinned CID checksums, contract invariants)
  and the unit/UI test suite.
- `npm run preflight` — the source preflight on its own.
- The design work is reviewed against a written contract; the rendered evidence lives in
  [`docs/design-review/`](docs/design-review/) together with the record that the design skill's checker validates.

## Repository layout

```
server.mjs              Express API, chain reader, store, wallet-message builder, moderation desk
public/                 Frontend: index.html (shell), app.js (SPA), styles.css (design system)
contracts/              Gno contracts: registry and collection template
nft-collection/         Pinned collection images and metadata
collections/            Additional collection assets served statically
data/                   Store (git-ignored) + demo-store.json for UI review only
scripts/                Preflight, pinning, contract helpers, release packaging
tests/                  Unit, API and UI-marker tests
docs/                   Architecture, design system, on-chain model, design-review evidence
vercel.json             Serverless deployment descriptor
```

## Deployment

`vercel.json` builds `server.mjs` as a Node serverless function and routes every request to it; the
frontend is served from the same process as static assets.

Two things matter on a serverless host:

- **The store needs a writable target.** The local filesystem is read-only there, so `DATABASE_URL`
  (Postgres) is the way to persist collections. The current deployment uses **Neon** (Postgres 18,
  Frankfurt, free tier, scale-to-zero): one row in `morrow_store` holds the whole catalogue as JSONB.
  Without it the catalog stays empty and collection creation returns an explicit error instead of
  failing silently.
- **Secrets stay in the project settings, never in git.** `.env` is ignored; the deployment takes the same
  variables through the platform's environment configuration.

The connection string is cleaned before it reaches the driver: `channel_binding=require` is removed
(node-postgres cannot negotiate it) and the server certificate is verified, with one transparent retry
over an encrypted but unverified connection if a provider's chain does not validate.

Locally the app keeps using its own JSON file store, so a local run never writes into the deployed
database.

## Limits, stated plainly

- The on-chain allowlist gate is not implemented — the UI says so.
- IPFS pinning needs a storage key; without it, artwork stays on the server.
- Transactions stay disabled until the registry, treasury and network flag are configured.
- The public catalog starts empty on purpose. `data/demo-store.json` holds four fictional collections
  (fake addresses) used only for UI review.
