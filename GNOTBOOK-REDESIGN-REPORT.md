# Gnotbook redesign report — 2026-10-20

## Delivered
- Rebranded the frontend as **Gnotbook**.
- Rebuilt the visual layer around a blue-and-white LEGO/brick motif, raised block cards, blue controls, and Space Grotesk + Inter typography.
- Replaced the always-visible desktop navigation with a left-side hamburger menu that opens/closes; retained responsive mobile behavior.
- Removed the homepage's featured direct-mint gallery and launch panel so it no longer promotes preloaded mintable editions.
- Added a Mintbook calendar with empty-state design, collection cards derived from the configured collection registry, and creator-submitted mint slots.
- Added date, start-time, free-mint flag, optional collection URL/realm, and whitelist file selection (.txt/.csv/.json).
- Changed asset cache-busting versions to `20261020-lego-1`.
- Added regression tests for the new calendar and UI direction.
- Excluded the uploaded `приватник.txt`, local browser profiles, temp artifacts, and `node_modules` from the release archive.

## Important behavior
- Registered collections are read from the existing marketplace API/state and appear in the Mintbook automatically.
- Creator-submitted calendar entries and whitelist counts are currently stored in that browser's local storage. The selected whitelist file is parsed locally; wallet addresses are not sent to the server or shared with other visitors. This avoids silently publishing wallet lists, but it means submissions are not yet a shared, server-persisted community calendar.
- The existing on-chain collection creation and secondary-market transaction code remains intact; the redesign removes the preloaded featured mint experience rather than pretending on-chain actions have been deployed or verified.

## Verification
- `npm test`: **28/28 passing** after updating checks to match the new product direction.
- JavaScript syntax check and project preflight pass.
