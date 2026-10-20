# Morrow new collections: Owl Collection, NEON SOULS, THE TREES

## Confirmed configuration

| Collection | Supply | Public mint | Founder reserve | Mint total if sold out |
|---|---:|---:|---:|---:|
| OWL COLLECTION | 333 | 5 GNOT | 0 | 1,665 GNOT |
| NEON SOULS | 666 | 5 GNOT | 0 | 3,330 GNOT |
| THE TREES | 575 | 5 GNOT | 0 | 2,875 GNOT |
| **Total** | **1,574** | **5 GNOT each** | **0** | **7,870 GNOT** |

Prices are in GNOT; the chain denomination is `ugnot`, where 1 GNOT = 1,000,000 ugnot. Each collection individually is within the current collection realm's `maxSupplyBound` (1,000,000) and founder reserve bound (0 is valid). The template accepts a configurable non-negative mint price, so 5 GNOT is representable as `5_000_000 ugnot`. This does not establish that these collections are already launched or exposed by the current web server.

## Assets and metadata

Each collection has its own directory under `collections/` with numbered WebP artwork, JSON metadata, and a manifest. Image files contain no text labels. Metadata uses `ipfs://PENDING_IMAGE_CID/...` until the image directory is uploaded; this placeholder intentionally blocks publication and is not a live URI. Do not deploy a realm with placeholder metadata.

## IPFS pinning (Octopin accounts)

1. Store the two Octopin API keys only in your local `.env` as `OCTOPIN_API_KEY_1` and `OCTOPIN_API_KEY_2`. Never commit or ship either key. Allocate collections between accounts according to each account’s available quota.
2. Run one collection at a time:
   - `npm run pin:new-collections -- --collection=owl-collection`
   - `npm run pin:new-collections -- --collection=neon-souls`
   - `npm run pin:new-collections -- --collection=the-trees`
3. The pinning workflow must upload images first, rewrite metadata with the returned image CID, then upload metadata. It must record returned CIDs as `PINNED_UNVERIFIED` until gateway verification passes.
4. Verify the returned CIDs and representative files through the configured public gateway, then run an exhaustive file verification before treating them as verified. The script deliberately does not claim gateway verification or deploy contracts.

Do not run `--all` until the account quota and upload budget are confirmed. All three collections require 3,148 individual files (1,574 images + 1,574 metadata JSON). Octopin Free's documented 2,000-file limit cannot host all three collections together; the currently used Octopin account was previously reported as already using 2,000/2,000. Use Pinata with sufficient quota or upgrade the pinning plan. A ZIP does not reduce the number of files counted once expanded by a directory pinning service.

## On-chain launch is separate

The current contract template accepts `maxSupply`, `mintPriceUgnot`, image/metadata bases and `founderReserve`; zero reserve is valid. The three collection configs are prepared, but the current server's primary collection integration is still GNO PUNK-specific. Before launching these collections, add/verify their registry entries and server-side discovery, deploy a separate realm per collection, and test public mint/list/buy/cancel on Onyx. Do not enable mainnet writes or state that mint is live until those steps are complete. Never send a wallet private key or seed phrase to anyone; sign transactions in the wallet.


## Octopin two-account publication

The three bundled collections are capped at 333 editions each (999 total; 1,998 image + metadata files) to fit within one unused 2,000-file Octopin account while retaining all three collections. `npm run pin:three-collections` reads `OCTOPIN_API_KEY_1` and `OCTOPIN_API_KEY_2` from local `.env`, checks each account's live quota, and reduces supply evenly if the combined remaining quota is smaller. It uploads images and metadata to the account with available capacity, rewrites metadata to real image CIDs, fetches every file back from the gateway and verifies SHA-256 before marking `PINNED_VERIFIED`. Do not put API keys into the ZIP or commit `.env`.

IPFS publication does not deploy contracts. The collection `launch_status` remains `NOT_DEPLOYED` until a signed `addpkg` transaction is confirmed on the selected Gno.land network and the real realm path is saved. Mainnet transactions must not be enabled merely to remove a UI warning.
