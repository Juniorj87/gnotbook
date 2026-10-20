# Morrow Afterglow UI update

## What changed

- Updated the visual system to the Afterglow direction: ink/navy surfaces, violet-to-cyan accents, subtle grid texture, softer translucent surfaces, and more deliberate contrast.
- Refined the brand mark, top navigation, active state, search field, buttons, hero presentation, listing cards, collection cards, portfolio surfaces, and Guardians feature.
- Preserved the existing GNO PUNK artwork and real API-driven data paths. No fake listings, owners, balances, verification badges, or successful transactions were added.
- Added URL-backed navigation for the main sections and detail pages. Routes are represented by hashes (`#market`, `#portfolio`, `#collection?path=...`, `#item?id=...&pkg=...`), so refresh preserves the selected view and browser Back/Forward can restore it.
- Added active navigation accessibility state (`aria-current`) and retained reduced-motion support.
- Bumped frontend asset versions to `20261018-afterglow-3` so browsers request the updated files.

## Functions already present in the original project

The original source already contained Market, Collections, Rewards, Activity, Portfolio and Create sections, a Portfolio disconnected-wallet state, listing actions, and the Guardians external mint link. These were preserved rather than duplicated. Visible collection branding is GNO PUNK; legacy internal `moonbound` identifiers remain where they are part of the existing configuration/data contract, to avoid silently breaking deployed realm references.

## Validation performed

- `node --check public/app.js` — passed.
- `node --check server.mjs` — passed.
- `node --check public/admin.js` — passed.
- `node --test tests/ui.test.mjs` — passed (7/7), including navigation sections, cache busting, route persistence, Afterglow styles, reduced-motion support, Guardians, and compact NFT gallery checks.

## Validation not completed

- Full `npm test` could not complete because dependency installation was interrupted in this environment; required packages such as `dotenv` were not available. `npm ci --offline` confirmed that a needed package was not cached. Re-run `npm ci` in an environment with npm registry access, then `npm test`.
- Browser visual verification and fresh screenshots could not be completed: the available headless browser was blocked by the environment before it could open the local preview. The existing screenshots in `docs/screenshots/` are prior baseline captures, not screenshots of this Afterglow revision. No claim is made that the updated pages were visually inspected in a browser.
- No Gno.land realm was deployed and no wallet transaction was signed. Mint, buy, list, cancel, and collection launch still depend on the project's configured registry, treasury, RPC, IPFS setup, and owner-authorized wallet actions.

## Run locally

Requirements: Node.js 20 or newer.

```bash
npm ci
npm test
npm start
```

Then open `http://localhost:4173` (or the port printed by the server).

## Replace an existing deployment

1. Make a backup of the current project and its `.env`, persistent `data/`, and server configuration.
2. Extract the ZIP into a new release directory rather than deleting the running release first.
3. Copy the existing production `.env` and required persistent data/configuration into the new release. Do not replace secrets with `.env.example`.
4. Run `npm ci` and `npm test`.
5. Start the new release in a staging environment and verify wallet/network configuration before switching traffic.
6. Do not enable mainnet writes or sign transactions until the owner has reviewed the configured registry, treasury, fee, and network settings.
