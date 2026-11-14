# Morrow — verification report (2026-11-14)

## Automated checks — PASS

Commands run against the updated source:

```text
npm run check       # syntax checks for server, frontend, admin and scripts
npm run preflight   # NFT corpus, metadata, checksums and source invariants
npm run test:unit   # 49 unit/integration/source tests
```

Result: **49/49 tests passed**, exit code 0.

The preflight verified:

- 1,000 unique WebP images and 1,000 valid metadata JSON files (2,000 source objects).
- The pinned image/metadata directory references and local manifest checksums.
- 111 archived editions / 224 ZIP entries outside the upload directories.
- The 5 GNOT collection launch fee, 5 GNOT GNO PUNK mint price, 2.5% sale fee, registry fee-sink gate, founder reserve cap and read-only mainnet defaults.

New tests cover the browser-side artist package generator, separate image/metadata directory CIDs, fixed-edition draft validation, launch argument shape and a catalog that does not perform RPC reads for un-deployed drafts.

## Artist bulk workflow — implemented, not live-pinned here

The Creator Studio now prepares up to 1,000 PNG/JPEG/WebP source images locally in the browser, converts PNG/JPEG to WebP, renumbers editions, and produces two distinct ZIP packages: `images/` and `metadata/`. The metadata package links each numbered edition to the image directory CID. The UI asks the artist to pin both folders with their own IPFS provider and verifies the first image, first edition JSON and collection JSON through public gateways before copying the CIDs into collection setup.

The builder is not a server-side multi-file upload service and does not store artists' IPFS API keys. It does not verify every one of the 1,000 files; it checks the first edition and collection metadata as a pre-launch gate.

## IPFS corpus

The bundled GNO PUNK corpus has 1,000 images and 1,000 edition metadata files. The static preflight checks object counts, WebP signatures, JSON validity and local manifest checksums. It does not constitute a fresh provider-side pinning job in this verification session.

## Not verified in this environment

- The Gno contracts were not compiled with the official Gno toolchain.
- No live Adena signing, realm deployment, mint, trade or fee settlement was run.
- The updated UI could not be rendered in Chromium here because browser navigation was blocked by the execution environment. The source-level UI checks and JavaScript syntax checks passed, but this is not a substitute for a real desktop/mobile visual QA pass.
- No independent smart-contract security audit was performed.

The current collection contract mints fixed editions one at a time through `PublicMint`, with a two-mint per-wallet limit. The artist pack builder makes the collection assets and metadata ready; it does not create a batch-mint transaction.
