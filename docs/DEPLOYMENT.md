# Morrow Marketplace — Deployment

## Modes

- **Read-only (default):** `GNOLAND_*_TRADING_ENABLED` unset. Browse, verify, upload (if Pinata set), admin moderation.
- **Testnet (Onyx):** set `GNOLAND_CHAIN_ID=onyx-1`, `GNOLAND_RPC_URL=https://rpc.onyx.testnets.gno.land:443`, `GNOLAND_ONYX_TRADING_ENABLED=true`.
- **Mainnet:** set `GNOLAND_CHAIN_ID=gnoland-1`, `GNOLAND_RPC_URL=https://rpc.gno.land:443`, `GNOLAND_MAINNET_TRADING_ENABLED=true` only after full review.

## Production checklist

1. `npm ci && npm test` passes.
2. `.env` created from `.env.example`; secrets only on the server.
3. `MORROW_TREASURY_ADDRESS` is a public Gno address; admin token is long and random.
4. `PINATA_JWT` set; `MAX_UPLOAD_MB` reviewed.
5. `DATABASE_URL` set for multi-instance; run migrations (`CREATE TABLE morrow_store` is auto-created on first read).
6. Behind an HTTPS reverse proxy (nginx/Caddy) with `TRUST_PROXY=true`.
7. Persistent volume for `data/store.json` and `nft-collection/`.
8. Healthcheck: `GET /healthz` must return 200.
9. Backups: nightly copy of DB (or `data/store.json`) + `nft-collection/`.
10. Rollback: keep previous release directory; restart with previous `.env`.

## Docker (suggested, not yet shipped)

A `Dockerfile` is not included in this release. Suggested base: `node:22-alpine`, copy project, `npm ci --omit=dev`, `CMD ["node","server.mjs"]`, expose 4173, mount `/app/data` and `/app/nft-collection`.

## Monitoring

- Watch `/healthz` uptime and `rpcHealthy` from `/api/config`.
- Alert on repeated 5xx or upload failures.
- Review admin queue (`/api/admin/queue`) regularly.
