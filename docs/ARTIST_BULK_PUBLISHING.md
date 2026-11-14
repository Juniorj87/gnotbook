# Artist bulk publishing guide

The Creator Studio has a **Bulk artwork** tab for preparing a numbered NFT collection. It runs in the artist's browser; the marketplace server does not receive the artwork files or the artist's Pinata/Octopin API key.

## Prepare the art

1. Open **Create collection → Bulk artwork**.
2. Select individual PNG, JPG/JPEG or WebP files, or choose a folder.
3. Files are sorted by filename (natural numeric order) and renumbered from `0001.webp`.
4. PNG/JPEG images are converted to WebP. Existing WebP files are retained.

Current limits: 1,000 images per package, 15 MB per source image, 150 MB total source size, 8,000 px maximum side and 40 MP maximum image area. Keep the original master files somewhere safe.

## Pin the image directory

1. Download **morrow-images-package.zip**.
2. Extract it and upload the extracted `images/` folder as a directory to your IPFS provider. Do not pin the ZIP file itself.
3. Copy the root directory CID and paste it into **Image directory CID**.

The expected files are `<image-CID>/0001.webp`, `<image-CID>/0002.webp`, and so on.

## Generate and pin metadata

1. Enter the collection name, description, optional website, and royalty percentage.
2. Click **Generate metadata package** and download **morrow-metadata-package.zip**.
3. Extract it and upload the extracted `metadata/` folder as a separate IPFS directory.
4. Paste that folder's root CID into **Metadata directory CID**.

The metadata folder contains one JSON file per edition (`0001.json`, `0002.json`, …), plus `collection.json` and a package manifest. Each edition JSON references its matching image path under the image directory CID. An optional artist JSON file can override edition names, descriptions and attributes; it can be an array or contain an `editions` / `items` array.

## Verify and create the collection

1. Click **Verify package**. The site resolves the first image, first edition metadata file and `collection.json` through public IPFS gateways. It checks the exact image URI and collection name.
2. Click **Use verified package in collection setup**.
3. Confirm the supply equals the number of prepared image files. Complete the ticker, realm slug, mint price, schedule and rights confirmation.
4. Review the displayed network, registry state and launch fee before signing with Adena.

The verification gate checks the first edition and collection metadata; it does not crawl and checksum every file in the artist's folder. Before a public drop, artists should spot-check the rest of the numbered paths in their IPFS provider or gateway.

## Current on-chain limits

- The creator pack prepares all images and JSON metadata, but it does not create a multi-mint transaction.
- The current collection contract mints one sequential edition per `PublicMint` transaction.
- The contract caps public minting at two editions per wallet.
- Fixed-edition public mint requires a positive paid mint price under the current contract; free public fixed-edition mint is not supported.
- Allowlist addresses can be privately prepared and counted in the app, but the current contract does not enforce allowlist proofs.
- New collections start unverified and should be reviewed before trading is enabled.

## Storage and safety

IPFS content is public and content-addressed. Anyone with the CID can read it; pinned content may remain available indefinitely. Never include private keys, seed phrases, API tokens or personal data in image files or metadata. The bulk workflow needs no IPFS secret on the marketplace server: artists pin from their own provider account and supply only the public CIDs.
