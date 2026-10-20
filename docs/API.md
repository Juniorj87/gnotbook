# Morrow Marketplace — API

Base URL: `http://127.0.0.1:4173` (or your deployed host). All `/api/*` routes are rate-limited (240/min general, 30/min writes).

## Public

- `GET /healthz` — `{ ok, uptimeSeconds, chainId }`.
- `GET /api/config` — safe public config, RPC/registry status and GNO PUNK parameters. No secrets.
- `GET /api/market` — `{ ok, collections, listings, warning, registryPath, featuredCollectionPath }`.
- `GET /api/collection-items?pkg=<realm>&offset=0&limit=24` — paginated items.
- `GET /api/traits?collection=moonbound` — pinned trait aggregates (GNO PUNK only).
- `GET /api/realm-read?pkg=<registered realm>&func=<allowlisted getter>&arg=...` — bounded read.
- `GET /api/wallet/:address/balances` — Gno bank balances.
- `GET /api/portfolio/:address` — registered collections and NFTs owned by the address.
- `GET /api/points/:address` — reward points.
- `POST /api/rewards/verify` — verify a confirmed tx hash and award points.
- `POST /api/report` — submit a moderation report.
- `POST /api/ipfs/image` — upload one image (multipart, `file`).
- `POST /api/ipfs/metadata` — pin metadata JSON.
- `GET /api/contracts/collection-template` / `registry-template` — Gno source text.

## Admin (requires `Authorization: Bearer <MORROW_ADMIN_TOKEN>`)

- `GET /api/admin/queue` — reports queue.
- `POST /api/admin/verify` — mark a collection verified.
- `POST /api/admin/report-status` — update report status.

## Errors

JSON `{ ok: false, error }` with appropriate HTTP status. Upstream Gno failures return 502.
