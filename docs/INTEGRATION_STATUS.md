# Integration status

## Implemented in source

- Independent Morrow registry contract and collection template; no third-party marketplace registry imports.
- Gno.land JSON-RPC read layer and configured registry collection/listing reads.
- Adena connection and active-chain matching before wallet-signing requests.
- Morrow collection deployment through the registry; fixed Moonbound edition mint; escrow list/buy/cancel functions in the collection template.
- Contract-enforced 2.5% protocol checkout fee, verified against the server's configured public treasury before purchases are enabled.
- Pinata server-side upload endpoints and 1,111-image / 1,111-metadata pinning script.
- Automatic homepage feature selection using the latest Morrow registry `FeaturedCollection()` value.
- Moderation/report routes, public configuration with secrets excluded, optional PostgreSQL persistence.
- Official Guardians Family outbound link only; no unverified internal mint.

## Not represented as complete

- No Gno contract compilation, deployment, or live transaction is certified by this package. The runtime compiler/chain tooling and a funded Adena wallet are outside the available local environment.
- The current package's source/preflight tests are not an independent smart-contract audit.
- IPFS CIDs are generated only after `npm run pin:moonbound` with a valid `PINATA_JWT`; no placeholder CID is passed off as live content.
- Guardians integration stays external until their contract and mint state can be verified directly on Gno.land.
