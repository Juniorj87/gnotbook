# Morrow Marketplace — Threat Model

## Assets

- User funds (GNOT) during mint/list/buy/launch.
- NFT ownership and supply integrity.
- IPFS-pinned artwork and metadata.
- Admin token and Pinata JWT (server-side only).
- Treasury and creator royalty flows.

## Threats and mitigations

| Threat | Mitigation | Status |
|--------|------------|--------|
| Fee/royalty bypass via direct contract call | `Buy` settles fee+royalty inside the realm; UI is not authoritative | Implemented in contract source (uncompiled here) |
| Underpayment / stale listing | `Buy` checks exact `price+floor(price/40)` and listing status before transfer | Implemented in contract source |
| Double purchase | Listing removed before settlement; second buyer fails | Implemented in contract source |
| Unauthorized listing cancel | `Cancel` checks `seller == caller` | Implemented in contract source |
| Supply overflow / duplicate edition | `PublicMint` increments `minted` and rejects `minted >= maxSupply`; sequential IDs | Implemented in contract source |
| Arbitrary realm proxy | `/api/realm-read` restricted to registered paths + allowlist | DONE |
| Secret leakage | Config endpoint omits secrets; verified by test | DONE |
| XSS via metadata/descriptions | `escapeHTML` on all user-derived strings in `app.js` | DONE |
| Path traversal / zip bombs / SVG execution | Multer MIME allowlist, single file, size cap; no SVG/HTML | DONE |
| IPFS SSRF | Gateway URL normalized to HTTPS; no user-controlled fetch targets | DONE |
| Admin takeover | Timing-safe token compare; token unset → deny all | DONE |
| Rate abuse | General 240/min, writes 30/min per IP | DONE |
| RPC/IPFS failure mid-flow | States distinguish broadcast/pending/confirmed/rejected/failed/timeout | PARTIAL (UI labels; no auto-retry) |

## Not addressed

- Offers/auctions are not implemented, so no escrow threat surface exists yet.
- No on-chain verification of the Gno source has been performed in this environment.
- No third-party security audit has been performed.
