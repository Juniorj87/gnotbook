# Morrow — three collection IPFS publication

## Collection supply after quota reduction

- OWL COLLECTION — 333 editions
- NEON SOULS — 333 editions
- THE TREES — 333 editions
- Total — 999 editions, 1,998 files (one WebP image and one JSON metadata file per edition)
- Mint price configured in metadata: 5 GNOT; founder reserve: 0
- GNO PUNK is a separate existing collection and already uses 2,000 files on its own Octopin account.

## Publish

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env`.
3. Set `OCTOPIN_API_KEY_1` and `OCTOPIN_API_KEY_2` in `.env` (server-side only; do not commit or share `.env`).
4. Run `npm ci`.
5. Run `npm run pin:three-collections`.

The uploader checks both live Octopin account quotas before uploading, keeps all three collections represented, reduces supplies if the combined quota is lower than expected, uploads each image directory and metadata directory, rewrites metadata with the returned image CID, then fetches every file back through the Octopin gateway and verifies SHA-256. Only after verification does it mark a collection `PINNED_VERIFIED`.

If an upload is interrupted, inspect each account's Octopin pins and `data/octopin-three-collections.json` before retrying; the script intentionally does not delete existing pins automatically.

## Chain status

IPFS pinning is separate from on-chain deployment. The collections remain `NOT_DEPLOYED` until the registry and collection realms are compiled, tested, deployed with a wallet-signed transaction on the selected network, and their real package paths are recorded. Mainnet RPC configuration is `https://rpc.gno.land:443` / `gnoland-1`; mainnet write transactions must remain disabled until the on-chain lifecycle has passed review. Never share a wallet seed phrase or private key.
