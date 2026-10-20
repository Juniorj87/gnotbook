# Integration status

## IPFS / Octopin — pinned and verified

- `scripts/pin-octopin.mjs` uses the documented endpoints:
  - `POST https://upload.octopin.app/api/upload` (`paths` + repeated `file` for folder-preserving uploads)
  - `GET https://api.octopin.app/api/me` for the plan and exact file count
  - `GET/DELETE https://api.octopin.app/psa/pins` for resume and stale-pin cleanup
- The key is read only from `OCTOPIN_API_KEY`; it is never written to disk, logged or sent to the browser.
- Every uploaded object is downloaded from `gateway.octopin.app` and SHA-256 verified. Metadata is parsed and checked field by field.
- Re-running reuses verified pins; stale pins are removed before re-upload.
- `data/collection-manifest.json` records both CIDs, 1,000 token mappings, checksums and the exact file budget.
- `MOONBOUND_IMAGE_BASE_URI` and `MOONBOUND_METADATA_BASE_URI` are set in `.env` only after verification.

### Verified objects

| Object | CID |
|---|---|
| Images | `bafybeiafu75cyf6crciag6nxtbg42i6wz2uqshwvg2yhi2fc6eexb75zim` |
| Metadata | `bafybeigrcymvrv5nvl7ay5sakrdxsjf5uxc2ejxhhlph5r3rbvdcyljbfe` |

Gateway: `https://gateway.octopin.app/ipfs/`.

## File budget

Octopin Free: 2,000 files / 1 GB.

| Item | Files |
|---|---|
| Published images | 1,000 |
| Published metadata JSON | 1,000 |
| **Published total** | **2,000** |
| Archived editions 1001–1111 | 222 (ZIP only, not uploaded) |

Octopin counts each file inside a folder upload; a ZIP is not expanded into a directory by the API. The collection was reduced from a planned 1,111 editions to 1,000 so the published drop fits the Free plan exactly. The remaining 111 editions are preserved with checksums in `nft-collection-archive/editions-1001-1111.zip`. A 1,111-edition drop requires an Octopin plan above 2,000 files.

## Metadata

All 1,000 JSON files pass preflight: unique `GNO PUNK #0001`–`#1000` names, edition traits, seven attributes, `external_url`, real `ipfs://` image URI, `image_sha256`, and no placeholder CIDs. `external_url` currently uses the documented `https://gno.land/` fallback; set `MORROW_PUBLIC_URL` to the real Morrow domain and re-pin metadata when that domain exists.

## Founder reserve

`Init` mints 333 editions to `MORROW_FOUNDER_ADDRESS` for network gas only. Metadata `founder_reserve: true` on editions 1–333 describes that contract behavior; it is not proof that a wallet already owns them. No private key or seed phrase is stored in the project.

## Not done / requires external action

- No realm has been deployed and no transaction has been signed. That requires a funded Adena wallet and the owner's explicit confirmation.
- A 1,111-edition publication requires a paid Octopin plan and a fresh verified pin.
- `MORROW_PUBLIC_URL` is still the `https://gno.land/` fallback; no verified Morrow production domain was supplied.
- Optional `MORROW_X_URL` / `MORROW_GITHUB_URL` are blank, so no social links are rendered.
