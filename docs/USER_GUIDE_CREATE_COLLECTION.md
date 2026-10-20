# Morrow Marketplace — User Guide: Create a Collection

1. Connect Adena to the same network as the server.
2. Open **Creator Studio**.
3. Fill in name, ticker (1–11 chars), realm slug (lowercase, 2–11 chars), description, supply cap (1–1,000,000), royalty (0–10%).
4. Upload a cover image (PNG/JPEG/WEBP/GIF, ≤ 15 MB). SVG/HTML are refused.
5. Check "I own or have permission…" and review the transaction note.
6. Review the **Launch cost** card: 250 GNOT deploy fee + gas, due now.
7. Review the **Launch rules** card: paid deploy via fee-sink gate, free only for the registry admin wallet, unique slug/realm, supply/royalty caps, IPFS bases both-or-neither, upload constraints, unverified by default.
8. Click **Pin to IPFS & launch collection**. Adena will ask you to sign; the fee is exactly 250 GNOT plus gas.
9. Do not retry if the page is slow. Check the transaction hash on the explorer first.
10. After confirmation, set `MORROW_REGISTRY_PATH` to the new realm path and restart the server. The collection then appears in the catalog and the featured banner updates from the registry.
11. Use `/admin` with `MORROW_ADMIN_TOKEN` to mark the collection verified after reviewing source, creator, cover, metadata and economics.

Note: new collections start unverified and cannot be bought until reviewed. IPFS pinning requires `PINATA_JWT` on the server.
