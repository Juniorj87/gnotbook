# On-chain model

What is enforced by contracts, what is enforced by the server, and what is honestly not implemented.

## Contracts

| Contract | Role |
|---|---|
| `contracts/registry/morrowmarket.gno` | the Gnotbook registry: registers collection realms, holds the launch fee sink, exposes `ListCollections`, `FeaturedCollection`, `FeeSink`, `Admin`, `LaunchFee`, `MarketplaceFeeBps` |
| collection template | per-collection realm: `Mint`, `Buy`, `List`, `Cancel`, `BalanceOf`, `TokenOfOwnerByIndex`, `TokenURI` |

A collection is a **realm** — a package on Gno.land. Morrow (Gnotbook) never owns a user's collection realm:
the creator deploys it, the registry only records that it exists and that its fee model matches.

## Money

| Flow | Amount | Where it is settled |
|---|---|---|
| Collection launch | 5 GNOT, once | registry fee sink, inside the deploy transaction |
| Public mint | 5 GNOT (GNO PUNK) | the collection contract |
| Secondary sale | ask + 2.5% | the collection contract, split between seller, royalty and platform fee in one transaction |
| Creator royalty | 0–10%, set at deployment | the collection contract, paid by the seller side |

Amounts are stored in `ugnot`; 1 GNOT = 1,000,000 ugnot. The server converts at the edge
(`toUgnot()`) and refuses non-integer or negative values.

The server checks the registry's own `FeeSink`, `LaunchFee` and `MarketplaceFeeBps` before it treats the
registry as usable. A registry with a different fee model is reported as incompatible rather than trusted.

## Founder reserve

At launch, a fixed number of editions (333 for GNO PUNK) is minted to the public founder address for gas
only. The reserve lives in the contract; the server reads `PublicMintLimit` and the minted count from the
realm. `MORROW_FOUNDER_RESERVE=0` launches a collection with no reserve.

## Allowlist model — what is real and what is not

**Real today:**

- the creator uploads a list of `g1…` addresses (TXT, CSV or JSON, ≤ 10,000 lines, ≤ 128 kB);
- the server validates the format, de-duplicates, counts and stores the list;
- the public API publishes the **count** and a boolean, never the addresses;
- the collection detail shows the allowlist size as a schedule entry.

**Not implemented yet:**

- the **on-chain allowlist gate**. The collection template does not yet prove allowlist membership on-chain,
  so a free mint is effectively public. The interface marks this as preparation-only instead of pretending
  the gate is enforced.

Closing that gap means the collection contract has to verify an allowlist proof (for example a Merkle root
committed at launch, checked against a signed proof per mint). The server side is already shaped for it: the
list, its digest and its count live in one place.

## Wallet boundary

- Adena (Gno.land) and Keplr (AtomOne) sign every transaction locally.
- The server builds unsigned messages; it never signs and never accepts a key.
- Adena reports an already-approved account as a failure. The client treats that as a usable session and
  proves it with `GetAccount` instead of blocking the user.

## Read model

| Data | Source |
|---|---|
| balance | `bank/balances/<address>` — a bare `"<amount><denom>"` string on the public RPC |
| holdings | `BalanceOf` + `TokenOfOwnerByIndex` per known realm, then `TokenURI` → metadata |
| listings | `ListOpen()` per collection realm |
| supply, mint price, limits | the collection realm itself |
| catalog | registry `ListCollections()` + the server store |

`TokenURI` takes the id as a **string**. Passing a bare number is a number literal that the realm ignores,
which is why the id is quoted before the call and a fallback call is kept for realms that expect a number.

## Mainnet safety

Transactions are off unless the deployment explicitly enables them. Three switches must all agree:
the network flag, a configured treasury, and a registry whose fee model matches. Read paths stay available
in every configuration, so a read-only deployment still shows the catalog, the market and portfolios.
