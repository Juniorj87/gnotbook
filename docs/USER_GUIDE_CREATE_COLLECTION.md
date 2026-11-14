# Morrow Marketplace — User Guide: Create a Collection

1. Connect Adena to the same network as the server.
2. Open **Creator Studio**.
3. Fill in name, ticker (1–11 chars), realm slug (lowercase, 2–11 chars), description, supply cap (1–1,000,000), royalty (0–10%).
4. For a single creator-minted item, pin the cover image and collection metadata. For a fixed-edition artist drop, open **Bulk artwork** and prepare up to 1,000 numbered images in the browser.
5. Download the image ZIP, extract it, and pin the `images/` folder as an IPFS directory. Paste the directory CID into the bulk workflow.
6. Generate the metadata ZIP, extract it, and pin its `metadata/` folder as a separate IPFS directory. Paste that directory CID and verify the first image, first edition JSON and `collection.json`.
7. Click **Use verified package in collection setup**. Confirm that supply matches the prepared edition count, set a paid public mint price, add the collection name/symbol/slug and check the artwork rights confirmation.
8. Review the **Launch cost** card: 5 GNOT deploy fee + gas for a normal creator wallet; the registry admin wallet is exempt.
9. Click **Launch on-chain**. Adena will ask you to sign the realm creation and initialization transaction. Do not retry if the page is slow; check the transaction hash on the explorer first.
9. Do not retry if the page is slow. Check the transaction hash on the explorer first.
10. After confirmation, check the transaction on the explorer and confirm that the realm is registered. Draft persistence is separate from the on-chain transaction.
11. Use `/admin` with `MORROW_ADMIN_TOKEN` to mark the collection verified after reviewing source, creator, cover, metadata and economics.

Important limits: the current contract mints one numbered edition per `PublicMint` transaction, with a two-mint per-wallet cap. The bulk tool prepares and verifies paired IPFS folders; it does not batch 1,000 on-chain mint operations. The allowlist is stored privately as preparation only and is not enforced by the current contract. New collections start unverified and cannot be bought until reviewed. Creators can pin through their own IPFS provider; the server pinning credential is optional for the bulk workflow.
