# Morrow Marketplace — Security

## Secrets

- `PINATA_JWT`, `MORROW_ADMIN_TOKEN`, `MORROW_TREASURY_ADDRESS` are server-side only. `/api/config` never returns them; verified by `tests/server.test.mjs`.
- Seed phrases and private keys are never requested, stored, or transmitted.

## Authentication

- Admin endpoints (`/api/admin/queue`, `/api/admin/verify`, `/api/admin/report-status`) require `Authorization: Bearer <MORROW_ADMIN_TOKEN>` compared with `crypto.timingSafeEqual`.
- If `MORROW_ADMIN_TOKEN` is unset, all admin requests are rejected.

## Transport and headers

- Helmet CSP: `default-src 'self'`, `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`. Inline scripts are blocked (verified in browser: CSP violation on inline stub).
- `x-powered-by` disabled. `trust proxy` off unless `TRUST_PROXY=true`.

## Rate limiting

- General: 240 req/min per IP on `/api/`.
- Writes: 30 req/min per IP.
- Uploads: multer `files: 1`, `fileSize` ≤ `MAX_UPLOAD_MB` (default 15), MIME allowlist PNG/JPEG/WEBP/GIF (SVG/HTML refused).

## Realm-read restriction

- `/api/realm-read` accepts only registered Morrow collection paths and an allowlist of read-only getters (`Name`, `Symbol`, `Creator`, `Cover`, `MaxSupply`, `Minted`, `MintPrice`, `RoyaltyBps`, `ImageBaseURI`, `AssetBaseURI`, `MetadataBaseURI`, `MarketplaceFeeBps`, `MarketplaceFeeSink`, `NextID`, `ItemLines`, `ItemLine`, `ListOpen`, `TokensOf`, `OwnerOf`). Arbitrary realm calls are rejected.

## On-chain safety

- Writes disabled unless `GNOLAND_*_TRADING_ENABLED=true` and the registry's `FeeSink()` matches `MORROW_TREASURY_ADDRESS` and `LaunchFee()==2_000_000_000` and `MarketplaceFeeBps()==250`.
- Fee is settled inside the collection realm's `Buy`; no separate UI fee transaction.
- `verifiedPaths` (env + store) gates whether a collection is marked verified; unverified collections block purchases in the UI.

## Dependencies

- `npm audit` should be run before release; no known critical findings are asserted here.
- `multer` 2.x, `express` 5.x, `helmet` 8.x, `express-rate-limit` 7.x.

## Remaining work

- PostgreSQL migrations and backup/restore procedures are not yet wired (JSON store is the default).
- No WAF/CDN in front of the app; deploy behind HTTPS reverse proxy (see `docs/DEPLOYMENT.md`).
