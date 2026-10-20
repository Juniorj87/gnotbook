# Morrow — implementation report (2026-10-18)

## Octopin / IPFS — complete for the published 1,000-edition drop

The Free plan counts every file inside a folder upload, so 1,111 editions would need 2,222 files. Per the owner's decision, the published drop is 1,000 editions and editions 1001–1111 are archived instead of bypassing the plan.

| Item | Result |
|---|---|
| Images | 1,000 WebP, CID `bafybeiafu75cyf6crciag6nxtbg42i6wz2uqshwvg2yhi2fc6eexb75zim` |
| Metadata | 1,000 JSON, CID `bafybeigrcymvrv5nvl7ay5sakrdxsjf5uxc2ejxhhlph5r3rbvdcyljbfe` |
| Octopin usage | 2,000 / 2,000 files, Free plan |
| Verification | Every object downloaded from `gateway.octopin.app` and SHA-256 checked |
| Token map | `data/collection-manifest.json` (IDs, paths, hashes, pin IDs) |
| Archived editions | 111 editions / 222 files in `nft-collection-archive/editions-1001-1111.zip` |

`scripts/pin-octopin.mjs` is a real uploader, not instructions: it reads the plan budget, refuses to exceed it, reuses verified pins, removes stale pins, rebuilds metadata with the verified image CID, uploads the metadata directory, verifies every JSON field, then writes the manifest and both `ipfs://` bases to `.env`. The API key is read only from `OCTOPIN_API_KEY` and is never logged or written to a shipped file.

Metadata contains no `IMAGE_DIRECTORY_CID` or other placeholders. Each JSON has a unique name, edition, seven traits, `external_url`, the pinned image URI and the artwork SHA-256.

## Founder reserve

The collection template enforces the reserve: `Init` accepts `founderReserve` only in 0–333 and mints editions 1..N to the explicit founder address. The metadata flag alone is not treated as ownership. `MORROW_FOUNDER_RESERVE=333`; no key or seed phrase is stored.

## Marketplace and design

- The public header no longer exposes deployment variables, block height or GNOSCAN links. That information moved to `/admin` → System diagnostics, which loads real `/api/config` and `/api/collection-manifest` data.
- **Midnight Atelier** palette and typography: graphite `#191B20`, panels `#23262D`, warm text `#F0EEE9`, one blue accent `#405CFF`, Space Grotesk headings, Manrope UI and system fallbacks.
- Homepage uses the real collection: 1,000 supply, live minted count, real marketplace fee, three real artwork files, working trait/rarity filters, sort, status filters and a compact listing empty state.
- Creator Studio has a real GNO PUNK launch panel; the button is disabled with an explicit reason until the wallet, registry, treasury, network flag and both IPFS bases are ready. No transaction is simulated.
- Footer social icons render only from `MORROW_X_URL` / `MORROW_GITHUB_URL`; they are hidden because no official accounts were supplied.
- Responsive layouts at 1440, 1024, 768, 390 and 360 px have no horizontal overflow or broken images.

## Verification

See `docs/TEST_REPORT.md`. `npm test` passes 11/11 tests, preflight passes, and the headless Chrome audit found zero console errors and zero failed requests.

## Remaining external actions

- Publishing 1,111 editions needs a paid Octopin plan (>2,000 files) and a fresh pin.
- Deploying the registry/collection and testing mint, buy, list and cancel needs a funded Adena wallet and the owner's explicit confirmation.
- `MORROW_PUBLIC_URL` is still the documented `https://gno.land/` fallback because no verified Morrow production domain was supplied; metadata `external_url` values should be re-pinned after setting it.
