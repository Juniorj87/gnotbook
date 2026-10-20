# Morrow UI repair notes — 2026-10-18

This release adds a focused visual repair to the current web client:

- Desktop navigation explicitly exposes Market, Collections, Rewards, Activity, Portfolio and Create; Portfolio replaces the older `My NFTs` label.
- `index.html` version-tags the client JavaScript and CSS to reduce stale asset caching after deployment.
- Item detail pages include two floating, animated editorial cards and a soft art-stage glow.
- The Explore gallery starts with six GNO PUNK editions and adds more only after the user presses “Show 6 more”; the featured drop strip shows only the next edition rather than three duplicate tiles.
- The collection creator preview uses a neutral art image until the user uploads their own cover, and the creator tab includes a separate Guardians spotlight linked to `https://guardians.family/mint`.
- The redundant footer row under GNO PUNK artwork is omitted because the artwork itself already contains its own title strip. The title strip is part of each WebP image, not a UI overlay; removing that embedded text from real editions would require regenerating and repinning the image/metadata set.

## Limits that remain

- The Guardians card is an external link, not an integrated Guardians contract or in-app mint flow.
- Portfolio reads only holdings that the Morrow server can index from registered collections.
- Minting/trading remains gated by server configuration and a deployed, verified collection realm. This UI repair does not deploy Gno contracts or turn on mainnet writes.
- The source/test/preflight suite can be run locally with `npm test`; that does not substitute for live wallet/RPC testing or Gno contract compilation.
