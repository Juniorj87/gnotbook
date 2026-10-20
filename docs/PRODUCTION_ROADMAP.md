# Production launch gates

## Gate 1 — service configuration

- Set the Pinata server key, treasury address, admin token and PostgreSQL URL.
- Enforce TLS and a strict reverse proxy; add Redis-backed rate limiting and upload quota alerts.
- Restrict the admin console with an identity-aware proxy or VPN/IP allowlist.
- Replace demo copy/terms with reviewed Terms of Service, privacy policy, copyright/takedown procedure, prohibited-content policy and creator rules.

## Gate 2 — contract correctness

- Compile the collection template with the current Gno toolchain and exact library versions.
- Deploy the factory-compatible template to a supported test network.
- Verify package deployment, initialization fee path, minted token metadata URI, owner/balance queries, escrow listing, cancel, settlement, creator royalty, protocol fee, platform fee and post-purchase ownership.
- Fuzz and audit integer arithmetic, fee rounding, reentrancy-like realm calls, ownership validation, marketplace state transitions, duplicate listing, self-buy and sold-out behavior.
- Keep mainnet transactions disabled until governance transfer restrictions are confirmed removed and an audited release passes.

## Gate 3 — wallet end-to-end

- Test current Adena API payload shapes and error handling for user rejection, extension not installed, stale account, wrong chain, low GNOT, RPC lag and failed multi-message transaction.
- Ensure users see full fee breakdown and destination; every state-changing flow must open Adena and must not fake success before confirmation.
- Index confirmed transaction results and handle mempool/confirmation delays idempotently.

## Gate 4 — indexer & points

- Add a production database schema for collection records, transaction receipts, points ledger, reports and moderation state rather than a single JSON document for large deployments.
- Add reliable chain event indexing/backfill and reorg/finality policy where supported.
- Reward points only once per finalized transaction and only for approved contract paths/events. Add an auditable points ledger and anti-sybil limits to quest campaigns.

## Gate 5 — creator and trust safety

- Keep all new realms unverified by default.
- Manual review should check namespace ownership, collection source, official links, creator declarations, sample assets and impersonation/rights reports.
- IPFS gives a stable content identifier; it does not guarantee that content is honest or licensed.
- Have a documented dispute/report, trademark/impersonation, stolen art, prohibited content, scam-wallet and moderation workflow.
- Connect Guardians only after the project provides a confirmed realm path and mint/transfer API. Never mark a planned mint as live.
- The founder reserve is minted by `Init` for network gas only. Treat those editions as real supply: they are numbered, owned and transferable from the launch block.
