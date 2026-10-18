# Morrow Marketplace — Gno.land

Morrow is an independent NFT marketplace for Gno.land. It has its own on-chain collection registry and collection template; it does **not** depend on another marketplace's registry or fee system. The web app provides collection discovery, collection pages, wallet-connected minting and escrow trading, IPFS pinning, basic portfolio/reward views, and a protected moderation desk.

## Economic rules in this build

| Action | Rule | Enforcement |
|---|---|---|
| Launch a Morrow collection | **2,000 GNOT once**, plus normal network gas | Hard-coded in the Morrow registry contract; its `LaunchFee()` is checked during Init |
| Moonbound Keepers primary mint | **575 GNOT** each, supply capped at **1,111** | Fixed in the deployed collection contract; sequential token IDs prevent duplicate edition IDs |
| Secondary sale | Buyer pays seller ask **plus 2.5% Morrow fee**, plus normal network gas | `Buy` checks the exact incoming amount and routes the protocol fee to the registry's configured treasury |
| Creator royalty | Set at collection deployment; Moonbound defaults to 2% | Enforced by the collection contract and paid from the seller's ask (not taken from the Morrow fee) |
| Guardians Family | Link to the official page only | No fake in-market mint: the official page must provide a live/verified contract before deeper integration |

GNOT amounts in code use `ugnot`, with 1 GNOT = 1,000,000 ugnot. A displayed protocol fee is separate from normal network gas. Marketplace purchases are disabled for collections unless their on-chain `MarketplaceFeeBps()` equals 250 and their `MarketplaceFeeSink()` matches the configured treasury. Existing third-party collection contracts are not silently treated as compatible.

## Included Moonbound Keepers assets

`nft-collection/images/` contains 1,111 distinct WebP files (`0001.webp`–`1111.webp`); `nft-collection/metadata/` contains the corresponding numbered JSON files (`0001.json`–`1111.json`). The metadata contains character/realm/rarity-style traits and a future-utility disclaimer. Images and metadata are local assets until you run the IPFS pinning step. No CID is invented or bundled as if it were already pinned.

## Requirements

- Node.js 20 or newer
- Adena wallet extension, configured to the same network as `.env`
- A Pinata API JWT with pinning permissions for the collection asset upload
- A public Gno address for `MORROW_TREASURY_ADDRESS`
- GNOT for transaction fees; launching Moonbound also requires exactly 2,000 GNOT plus network gas

## Install and start (Windows)

1. Extract the ZIP into a writable folder.
2. Copy `.env.example` to `.env` (the `run-morrow.bat` launcher can create the copy on first run).
3. Open PowerShell in the project folder and run:

   ```powershell
   npm install
   npm test
   npm start
   ```

4. Open `http://127.0.0.1:4173`. The app is deliberately **read-only by default** until writes have been explicitly enabled in `.env` and the on-chain registry is configured.

For the one-click Windows launcher, double-click `run-morrow.bat`. For Linux/macOS, run `bash run-morrow.sh`.

## Deployment sequence

### 1. Configure the public treasury and network

Set `MORROW_TREASURY_ADDRESS` to a public Gno address. Never place a seed phrase, private key, or wallet password in `.env`. The default network is Gno.land mainnet (`gnoland-1`, `https://rpc.gno.land:443`). Write operations are disabled by default. After reviewing source and intended network, explicitly set `GNOLAND_MAINNET_TRADING_ENABLED=true` for mainnet or `GNOLAND_ONYX_TRADING_ENABLED=true` for Onyx (and switch both the RPC URL and chain ID to Onyx if you are testing there).

### 2. Pin Moonbound assets to IPFS

Set `PINATA_JWT`, then run:

```powershell
npm run pin:moonbound
```

This pins 1,111 images and 1,111 metadata entries and rewrites each metadata image URI to the resulting image-directory CID before pinning the metadata directory. Copy the two emitted directory URIs into `.env`:

```dotenv
MOONBOUND_IMAGE_BASE_URI=ipfs://YOUR_IMAGE_DIRECTORY_CID
MOONBOUND_METADATA_BASE_URI=ipfs://YOUR_METADATA_DIRECTORY_CID
```

Restart the server after changing `.env`. The script only uploads assets; it does not deploy contracts or mint NFTs. It writes `nft-collection/PIN_RESULTS.txt` and `nft-collection/pinned-manifest.json` locally; these run-specific CID files are not included in source control.

### 3. Deploy the Morrow registry

Connect Adena to the same network as `.env`, go to **Creator Studio**, and use **Deploy Morrow Registry**. Review the package path, public fee-sink address and gas in Adena before signing. After the deployment transaction confirms, copy the actual realm path, for example `gno.land/r/<your-address>/morrowmarket`, into `MORROW_REGISTRY_PATH` in `.env`, restart the server, and reload the site.

The backend verifies that the registry's on-chain `FeeSink()` exactly matches `MORROW_TREASURY_ADDRESS` before enabling fee-bearing transactions. If the paths or addresses mismatch, transactions remain blocked.

### 4. Launch Moonbound Keepers

In **Creator Studio → Featured Launch**, confirm the 2 IPFS directory URIs and click **Launch Moonbound Keepers**. The launch is a permanent on-chain action, not a preview. Adena must show the launch transaction and payment of exactly 2,000 GNOT plus network gas. The collection is fixed to:

- 1,111 editions, sequentially numbered `#0001` through `#1111`;
- primary mint price 575 GNOT per edition;
- 2% creator royalty;
- each edition ID may be minted once only.

Do not retry a transaction merely because the page is slow. Check the transaction hash and registry on Gno.land first. A successful wallet popup alone is not a claim that the chain confirmed it.

### 5. Verify collection and test a full lifecycle

Use `/admin` with `MORROW_ADMIN_TOKEN` to review the realm and mark it as verified only after checking the published source, creator, cover, metadata and contract economics. Verification is a moderation label, not a cryptographic guarantee. Test with low-risk amounts on a supported test network first. Before accepting a live listing, confirm that the item's collection is reviewed, its on-chain fee interface returns exactly 250 basis points and the on-chain fee sink matches the server treasury. Then test list → buy → owner change → cancel/withdraw where applicable, and inspect every confirmed transaction on the explorer.

## Guardians Family

Morrow provides a link to `https://guardians.family/`, the official project site. It does not claim to mint their NFTs inside Morrow, import an unverified contract, or present the official mint as an enabled on-chain flow unless the project's contract is publicly connected and independently verified. Check the official page and transaction details before paying; the status can change.

## API and operations

- `GET /healthz` — process health
- `GET /api/config` — safe public configuration and current RPC/registry status; no secrets
- `GET /api/market` — registered collections, fee compatibility flags, active listings and featured collection path
- `GET /api/collection-items?pkg=<realm>&offset=0&limit=24` — paginated items
- `GET /api/realm-read?pkg=<realm>&func=<read-only-function>` — bounded public realm read
- `POST /api/ipfs/image` / `POST /api/ipfs/metadata` — IPFS pinning via server-side Pinata token
- `/admin` — protected reports and manual verification

PostgreSQL is optional. With `DATABASE_URL` blank, reports, moderation and reward state use `data/store.json`. For multi-instance production, use managed PostgreSQL and enable backups. Put the app behind HTTPS, rotate admin tokens, rate-limit uploads, and never expose `PINATA_JWT` or `MORROW_ADMIN_TOKEN` to frontend code.

## Checks and known boundaries

Run `npm test` before every package/deployment. It performs JavaScript syntax checks plus a source/asset preflight (counts the image/metadata pairs, parses JSON, checks image signatures, hashes images, checks fee constants and confirms obsolete third-party dependencies are absent). The preflight does **not** compile Gno or replace an independent smart-contract audit.

The Gno compiler/runtime and a funded Adena wallet are not included in this package execution environment. Therefore this deliverable does not claim the included Gno source has been compiler-verified, deployed, live-minted, or tested end-to-end on-chain. Before mainnet funds are enabled, compile and simulate both `contracts/registry/morrowmarket.gno` and the generated `contracts/templates/morrow-collection.gno` using the current official Gno toolchain, review the generated package code, deploy/test on Onyx, and complete an independent smart-contract security review. Do not accept real funds until those checks pass.
