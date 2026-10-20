# Morrow — test report (2026-10-20)

## Automated — PASS

```
npm test
  npm run check      # node --check for server, app, admin, preflight, build, pin, archive
  npm run preflight  # 1,000 images + 1,000 JSON, manifest, archive, secrets
  npm run test:unit  # 28 tests
```

Result: **28/28 tests passed**, exit code 0.

Preflight output:

- 1,000 unique WebP images + 1,000 verified metadata files = 2,000 files (Octopin cap 2,000).
- Both `ipfs://` directory bases present; manifest checksums and token mapping verified.
- 111 archived editions / 224 ZIP entries, outside the upload directories.
- Founder reserve 333, 250 GNOT launch, 5 GNOT mint, 2.5% sale fee and read-only mainnet defaults checked in source.
- No Octopin key or Pinata JWT present in `public/`, `nft-collection/`, `data/` or the archive.

The test suite includes server and UI tests: healthz & API health checks, config secret hygiene, traits endpoints, realm-read allowlist, market endpoints, manifest checks, fee math (2.5%), navigation routes, cache busting, route persistence across history, Afterglow visual system, floating item cards, Guardians feature, progressive Punk gallery, admin launch fee waivers, creator studio registry deployment, per-wallet mint cap gating, Adena connection resilience, Adena contract call formatting, and multi-collection mint support (Owl, Trees, Neon Souls).

## IPFS — PASS

The pin script fetched all 2,000 objects back from `gateway.octopin.app` and compared SHA-256. A separate spot check returned HTTP 200 for:

- `bafybeiafu75cyf6crciag6nxtbg42i6wz2uqshwvg2yhi2fc6eexb75zim/0001.webp`
- `bafybeigrcymvrv5nvl7ay5sakrdxsjf5uxc2ejxhhlph5r3rbvdcyljbfe/0001.json`

Octopin reports **2,000 / 2,000 files** on the Free plan.

## Headless Chrome — PASS

Chrome via the DevTools protocol, real server at `http://127.0.0.1:4173`.

| Viewport | Horizontal overflow | Broken images | Console errors | Failed requests |
|---|---|---|---|---|
| 1440×1100 | none | 0 | 0 | 0 |
| 1024×900 | none | 0 | 0 | 0 |
| 768×1000 | none | 0 | 0 | 0 |
| 390×844 | none | 0 | 0 | 0 |
| 360×800 | none | 0 | 0 | 0 |

Routes rendered: Explore (`DISCOVER RARE DIGITAL COLLECTIBLES`), Market, Collections, Activity, Portfolio, Create (`Creator Studio`), item `GNO PUNK #0001` with 7 traits and an Octopin-hosted image. `/admin` exposes the diagnostics panel and loaded real chain, pinning and manifest data; the public header contains no technical strip.

Screenshots: `docs/screenshots/home-1440.png`, `docs/screenshots/home-390.png`, `docs/shot-explore.png`, `docs/shot-create.png`, `docs/shot-collection.png`, `docs/shot-item.png`. Raw metrics: `docs/screenshots/browser-audit.json`.

## Not tested

- Gno contract compilation (no toolchain in this environment).
- On-chain launch, mint, buy, list and cancel (no deployed realm, no funded Adena wallet, no owner confirmation).
- A 1,111-edition pin (requires a paid Octopin plan above 2,000 files).
- PostgreSQL paths (no database instance).
