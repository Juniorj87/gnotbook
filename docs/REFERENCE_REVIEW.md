# Reference review: Nomaq and open Gno marketplace patterns

Date reviewed: 2026-10-16

## Nomaq (`https://nomaq.xyz/#/rewards`)

The supplied Nomaq URL resolves as a client-side web application with hash-based routing. The available page reader did not expose the rendered `#/rewards` content or an inspectable implementation, so this report does **not** claim that a specific Nomaq feature has been verified. Use it as a hands-on reference in a normal browser, not as evidence that its internal contracts or reward verification are secure.

## Concrete Gno-native reference: Memba

Repository: https://github.com/samouraiworld/memba  
License shown by the repository: MIT.  
The README describes Memba as experimental/alpha and unaudited; production use needs an independent review.

Useful product ideas described by that project:

1. **Market actions:** active NFT listings, Buy Now, Make Offer, and an on-chain activity feed.
2. **Offer safety:** escrow-backed offers with a seven-day expiry/safety valve.
3. **Creator experience:** a multi-step collection launch wizard supporting GRC-721 unique items and GRC-1155 editions/supply caps.
4. **Rewards:** categorized quests, prerequisite chains, multiple verification types, ranks, leaderboard and badge NFTs.
5. **Quality:** parser/unit tests, Playwright smoke tests, template compilation gates, security guardrails and explicit feature flags.

These ideas are product/architecture references, not proof that Morrow currently implements them. Morrow currently has a server-backed live-read path for configured factory collections and a basic points/quests surface. Escrow offers, full historical event indexing, GRC-1155 editions, a leaderboard and audited contract deployment remain separate implementation/review tasks unless a live contract path is added and tested.

## Morrow decisions

- Preserve the non-custodial model: private keys and seed phrases never enter Morrow.
- Never mark a collection as safe solely because its metadata or images are pinned to IPFS. IPFS provides content addressing, not creator identity or copyright legitimacy.
- Show studio artwork as preview-only, never as live inventory or fake floor-price data.
- Award points only after the backend verifies a unique confirmed transaction against the expected realm, method/event and wallet address.
- Add offers and editions only after a matching, tested Gno contract interface exists; a button alone is not a feature.
- Gate state-changing mainnet calls until the chain status, contracts, wallet API and final transaction outcome have all been tested.

## Source links

- Nomaq: https://nomaq.xyz/#/rewards
- Memba source and README: https://github.com/samouraiworld/memba
- Gno JSON-RPC documentation: https://docs.gno.land/resources/rpc-endpoints/
- GnoConnect wallet/client standard: https://docs.gno.land/resources/gnoconnect/
