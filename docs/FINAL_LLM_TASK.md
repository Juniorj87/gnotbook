# FINAL IMPLEMENTATION TASK — MORROW NFT MARKETPLACE

You are taking over an existing Gno.land NFT marketplace project. This is an implementation task, not a design critique. Work in the supplied repository, modify the files, run the app, test it in a real browser, and return a finished ZIP. Do not stop after making a plan or producing another static mockup.

## Primary outcome

Deliver a cohesive, premium NFT marketplace for Gno.land, with a distinct visual identity and a truthful, safe user journey. The attached `design-reference/marketplace-art-direction-reference.png` is a visual direction reference for hierarchy and density (editorial hero, left navigation, featured collection, market grids, compact right rail). It is NOT a source of factual collection data. Do not copy its fake stats, names, prices, owners, verification marks, or transaction activity.

## First: understand the two entry points

- `index.html` at the repository root is only a static local design preview. It cannot connect a wallet, query RPC, pin files or submit transactions. Keep this distinction clear.
- `public/index.html` is the server-backed application served by Express. This is the actual product that must be improved and tested at `http://127.0.0.1:4173`.
- Existing server, app logic, styles, Gno contract template, environment configuration, fee model, IPFS setup and QA docs must be read before changing architecture. Preserve working code. Avoid rewriting the app from scratch just to get a screenshot.

## Phase 1 — run and baseline

1. Check Node.js 20+, install dependencies, run `npm test`, then `npm start`.
2. Open the server-backed app in a real browser. Inspect console, network, mobile/desktop breakpoints, server logs, all routes and every interactive control.
3. Record baseline defects in `docs/QA_REPORT.md` before fixing them. Separate UI, RPC, Adena, IPFS, contract, persistence, rewards and security findings.
4. Inspect the actual API responses before claiming what is live. Verify `/api/config`, `/api/health` and `/api/market`.

## Phase 2 — visual product redesign

Implement in the real app (`public/index.html`, `public/styles.css`, `public/app.js` and assets), not only in the root preview.

### Art direction
- Build a premium dark digital-art gallery: near-black/ink surfaces, restrained acid-lime accent, warm ivory typography, subtle metallic/olive secondary colors, high contrast and deliberate spacing.
- The result must feel like an independent art marketplace, not a generic SaaS dashboard, template, or AI-generated gradient landing page.
- Establish a clear information hierarchy: branded navigation; high-impact editorial hero; featured ecosystem collection; live marketplace listings; latest drops; collection discovery; compact wallet/rewards summary where useful.
- On wide screens, consider a compact left rail and optional right rail for wallet status/top sellers only if data exists. Keep the central gallery visually dominant. On mobile, convert rails into a usable drawer/stack without horizontal overflow.
- Use strong, consistent artwork crops; design meaningful loading, empty, error, unverified, external-project, preview-only and live-listing states. No random unrelated image placeholders.
- NFT cards must clearly distinguish LIVE LISTING, ON-CHAIN / NOT LISTED, STUDIO PREVIEW and EXTERNAL PROJECT. Show current price only when it is returned by a valid listing query. Never invent floor price, volume, owners, ranking or trade history.
- Create a useful NFT detail view with full artwork, name, collection/realm path, owner if queryable, token ID, attributes if available, listing price, marketplace fee, royalty if contract-enforced, chain/explorer links and an actionable buy flow only when verified and enabled.
- Create collection detail views with cover art, creator/realm path, supply/minted count when readable, royalty settings, item grid, verification state and clear warnings. Avoid fake verification badges.
- Portfolio should show real connected-wallet holdings and balances or a truthful unsupported/indexing state. Rewards must explain how points are verified and show a transparent event history.
- Creator Studio should have a guided, non-technical collection setup: name, description, artwork upload, supply/royalty settings, review/fees, wallet signing, deployment status and explorer link. Disable unavailable actions with an explicit reason.
- Add polished interaction states, keyboard focus, accessible labels, reduced-motion support, image loading/error handling, responsive layouts and useful toast/modal messages.

### Visual QA acceptance
- At 1440px: no accidental dead space, clipped text or broken columns; the marketplace should look intentionally art-directed.
- At 390px: no horizontal scrolling; wallet, navigation, filters, cards and modals remain usable.
- Every button must do something real, navigate, or be explicitly disabled with a reason. No inert CTA.
- The root preview must say it is static and point users to the live server app. Do not call the static preview the completed marketplace.
- Include screenshots of the real server-backed app at desktop and mobile sizes in the returned QA artifacts.

## Phase 3 — truthful on-chain functionality

### Wallet and custody
- Use the existing Adena/GnoConnect integration where compatible; confirm the currently supported wallet API against official documentation rather than guessing method names.
- Never request, transmit, log or store a seed phrase or private key. Only request public account information and let Adena sign user-approved transactions.
- Handle missing extension, permission denial, account switch, wrong chain, rejected signature, RPC outage and transaction failure.

### Trading
- Verify every transaction's realm path, method, arguments, token ID, receiver, price, platform fee and royalty semantics against the actual deployed contract before exposing the action.
- A wallet popup or broadcast acceptance is not a successful sale. Wait for a confirmed transaction result and verify resulting ownership/listing state.
- Mainnet trading must remain disabled unless the contract interface and transaction flow have been independently verified. Use a dedicated test wallet/testnet for E2E tests. Never use real funds for exploratory testing.
- Do not implement fake escrow, offers, auctions, GRC-1155, royalties, cancellation or buy-now semantics by only adding UI. If no compatible deployed contract exists, mark it as a blocker and write the required contract work.

### Collections, IPFS and anti-scam
- IPFS pinning gives content addressing, not authenticity, copyright clearance or trust. Explain that distinction in UI.
- Never label a collection “verified” only because it has an IPFS URL or a factory record. Document the actual verification process and who can grant it.
- Validate file MIME type, size, metadata schema, external URLs and upload errors. Secrets such as `PINATA_JWT`, database credentials and admin tokens must stay server-side.
- Collection creation and minting must be gated by configured services, correct network and confirmed fee display. Never imply a collection deployed if the transaction failed.

### Rewards and persistence
- Grant points only after server-side verification of a unique, confirmed transaction that matches expected chain, realm, method/event and wallet address. Prevent replay/double credit.
- Distinguish persistent database storage from local fallback/demo state. Do not imply points or listings are durable when they are only in process memory or localStorage.

## Phase 4 — implementation and test gate

1. Fix all P0/P1 bugs that can be safely fixed within the project.
2. Add or update tests for routes, validation, transaction-result parsing, points idempotency, frontend critical paths and responsive rendering.
3. Run `npm test`, any contract/toolchain checks that are actually available, and browser E2E tests. Capture exact command output and exit status.
4. Verify no secrets are included in frontend bundles, ZIP or screenshots. Review `.env`, admin routes, upload handling, CORS/CSP, rate limits, and transaction gates.
5. Re-zip the complete project, excluding `node_modules`, real `.env`, credentials, logs and test wallet secrets.

## Required deliverables

- Updated complete project ZIP with `index.html`, `public/`, `server.mjs`, `contracts/`, scripts and docs.
- `docs/QA_REPORT.md` listing exact commands, tests, screenshots, results, defects fixed and remaining blockers.
- Desktop and mobile screenshots of the actual server-backed app, not just a generated concept.
- A feature matrix with statuses: VERIFIED WORKING, IMPLEMENTED BUT NOT E2E VERIFIED, BLOCKED BY CONTRACT/NETWORK/KEYS, NOT IMPLEMENTED.
- A short operator guide: setup, environment variables, local launch, testnet setup, safe mainnet gates and troubleshooting.

## Non-negotiable honesty rule

Do not report a feature as working unless it was exercised and the result observed. Do not invent browser screenshots, transaction hashes, contract compilation results, collection statistics or security audit outcomes. If credentials, deployed contracts, RPC access or a browser are unavailable, state the blocker and provide exact reproducible next steps. Do not call the product production-ready without independent contract/security review and successful on-chain end-to-end tests.
