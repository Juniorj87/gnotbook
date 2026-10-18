# Trust, security and privacy

- Morrow never asks for, receives or stores wallet seed phrases or private keys. Adena signs transactions.
- Mainnet writes are disabled in `.env.example`. Explicitly enable only after contract compilation, test-network validation and review.
- Pinata JWT and moderation token remain server-side. The public config endpoint emits only safe settings and does not reveal those tokens.
- IPFS CIDs verify content addressing, not ownership or legitimacy. Moderation verification is a human review status, not a cryptographic certification.
- Purchases are blocked for collections whose on-chain marketplace fee method or fee recipient cannot be confirmed against configuration.
- Collection name, supply and mint prices are checked on chain at launch and must be cross-checked against the confirmed realm before promoting it.
- Do not treat a submitted Adena transaction as confirmed until it appears successfully on chain. Do not retry an uncertain collection-launch transaction before checking its hash.
- Guardians Family is an external link. Morrow must not present an inactive or unverified third-party mint as if Morrow can execute it.
