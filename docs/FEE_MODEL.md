# Morrow fee model

- Collection deployment: exactly **250 GNOT** (`250_000_000 ugnot`) once. The fee is defined by the Morrow registry and is sent to the registry's public treasury address during collection initialization. Normal network gas is separate.
- GNO PUNK primary mint: exactly **5 GNOT** (`5_000_000 ugnot`) per unique edition, capped at 1,000 sequential token IDs.
- Secondary sale: buyer sends the seller's ask plus `floor(askUgnot / 40)` (2.5% rounded down at ugnot precision), plus normal network gas. The collection contract enforces the total incoming amount and transfers the protocol fee to the registry's fee sink. Seller proceeds equal ask less royalty; creator royalty is paid separately from the ask.
- Collection compatibility: the market refuses purchases from a collection unless its on-chain `MarketplaceFeeBps()` is 250 and `MarketplaceFeeSink()` matches `MORROW_TREASURY_ADDRESS`. Unknown external collections are not implicitly safe.

Never change just the UI constant to change a fee. Any future economic change requires an explicit contract upgrade/new version, corresponding tests, and a transparent UI update.
