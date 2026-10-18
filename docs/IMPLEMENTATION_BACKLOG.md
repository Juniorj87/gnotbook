# Morrow Marketplace — Implementation Backlog

Status legend: `DONE` · `PARTIAL` · `BLOCKED` · `NOT IMPLEMENTED`.

## P0 — Core product (done this session)

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | SPA loads, routes render distinct pages | DONE | browser sweep: explore/collections/activity/portfolio/create all render, 0 console errors |
| 2 | Wallet modal, favorites persistence | DONE | localStorage `["0003"]` verified |
| 3 | Locked edition tile → item page | DONE | `Moonbound Keepers #0001`, `edition 0001 of 1111`, `Unrevealed` |
| 4 | `saleTotal` fee math (2.5% floor) | DONE | 1000000 → fee 25000/total 1025000; 575000000 → 14375000/589375000 |
| 5 | Checkout total display | DONE | `10.25 GNOT` modal |
| 6 | Connect-Adena gate before signing | DONE | `sendTx` → "Connect Adena before signing a transaction." |
| 7 | Explore page concept parity (hero, drops, collections) | DONE | screenshot `docs/shot-explore.png` |
| 8 | Collection page: facets, sort, tabs, rarity distribution | DONE | 7 trait groups, 11 Mythic filter verified against metadata files |
| 9 | Item page: real pinned trait table | DONE | `#0024` shows 7 traits from `metadata/0024.json` |
| 10 | Creator studio: launch-cost + launch-rules panels | DONE | screenshot `docs/shot-create.png` |
| 11 | `/api/traits` endpoint (real counts) | DONE | 1111 total, 7 groups, 404 for unknown slug |
| 12 | `/api/realm-read` restricted to registered + allowlist | DONE | tests/server.test.mjs passes |
| 13 | Unit/integration tests | DONE | 8 tests pass (`npm run test:unit`) |
| 14 | `npm test` invariant gate | DONE | check + preflight + test:unit green |

## P1 — Blocked by environment

| # | Item | Status | Blocker |
|---|------|--------|---------|
| 15 | Gno contract compilation | BLOCKED | `gno`/`gnodev` not installed; cannot verify compilation here |
| 16 | Deploy registry / launch Moonbound | BLOCKED | no funded Adena wallet, no treasury address configured |
| 17 | End-to-end mint/buy/cancel on chain | BLOCKED | requires deployed realm + funded wallet + `GNOLAND_*_TRADING_ENABLED` |
| 18 | IPFS pinning with real CIDs | BLOCKED | no `PINATA_JWT` in this environment |
| 19 | PostgreSQL production store | PARTIAL | `pg` dependency + code path exist; no DB provisioned |
| 20 | Offers and auctions | NOT IMPLEMENTED | no escrow contract; disabled to avoid fake success states |

## P2 — Deliberately not implemented (would be false claims)

- "3 per wallet" (mock claim): contract has no per-wallet cap, only `maxSupply`.
- "1–10,000 file folder dropzone": server accepts one file per request.
- "One collection per wallet / 24h", "100 files/day per address", "duplicate art hash check": not enforced on-chain or server-side.
- "Admin override 0 GNOT": registry `LaunchFee()` is fixed at 2,000 GNOT with no exemption.
- Hash/deep-link routing: nav is click-driven (`data-route` → `routeTo()`).
