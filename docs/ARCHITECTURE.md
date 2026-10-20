# Architecture

How Gnotbook is put together, and why each piece is the way it is.

## Shape of the system

```
                 browser (no build step, no framework)
  ┌──────────────────────────────────────────────────────────────┐
  │  public/index.html   shell: topbar, icon rail, main, footer │
  │  public/app.js       SPA: hash router + renderers + actions │
  │  public/styles.css   design system (tokens → components)   │
  └───────────────┬───────────────────────────────┬──────────────┘
                  │ fetch(/api/*)                 │ window.adena / window.keplr
                  ▼                               ▼
  ┌────────────────────────────────────────┐   ┌─────────────────────┐
  │  server.mjs (Express)                  │   │ wallet (signs)      │
  │  ├ chain reader   (ABCI qeval)         │   └──────────┬──────────┘
  │  ├ catalog        (store + registry)   │              │ signed tx
  │  ├ store          (JSON | Postgres)    │              ▼
  │  ├ upload/pinning (IPFS)               │        Gno.land / AtomOne
  │  └ tx builder     (unsigned messages)  │
  └───────────────┬────────────────────────┘
                  │ qeval_json / abci_query
                  ▼
        Gno.land public RPC  →  registry realm  →  collection realms
```

The server has three responsibilities and no more: **read the chain**, **keep small non-custodial records**,
and **build unsigned transaction messages**. It never signs, never holds a key and never claims to own an NFT.

## Backend

### Chain reader

Everything on-chain goes through one primitive:

```js
abciQuery('vm/qeval_json', '<realm>.<Func>(<args>)')
```

The expression is built by `evalValues()`, which quotes arguments by type. That quoting is not cosmetic —
`TokenURI(314)` (a number literal) returns nothing on a realm that expects `TokenURI("314")`, which is
exactly the kind of silent empty read that makes a portfolio look broken. String arguments are therefore
passed quoted, and numeric arguments are passed bare.

Responses arrive in Gno's amino envelope and are decoded by `decodeAmino()`:

| Wire shape | Meaning | Decoded to |
|---|---|---|
| `V: {value: "..."}` + `@type: /gno.StringValue` | string | string |
| `V: {value: "123"}` | numeric string | number when safe |
| `V: {value: "true"}` | bool | boolean |
| `N: "<base64>"` | amino-encoded number | number |
| `V: {value: "<base64>"}` | raw bytes | decoded string |

`unwrapResults()` flattens the `{"results":[…]}` envelope so a caller can work with plain values.

### Catalog

`getCollections()` merges three sources into one list:

1. `DEFAULT_COLLECTIONS` — empty by design, no demo data ships.
2. The server store: drafts saved by creators, plus verified paths.
3. The on-chain registry: `ListCollections()` on the registry realm, each entry enriched with the collection's
   own live values.

The result is annotated with allowlist **counts** and a `featured` flag. The store also holds allowlists; the
public payload exposes only `allowlistCount` and `allowlistPrepared`, never the addresses.

### Store

`readStore()` / `writeStore()` / `mutateStore()` give the rest of the server a single serialized writer
(`STORE_LOCK` chains mutations so two concurrent requests cannot interleave a read-modify-write).

Two backends: a local JSON file (atomic write via a temp file + rename) and Postgres when `DATABASE_URL`
is set. On a read-only filesystem the write fails with an explicit message that points at `DATABASE_URL`
instead of surfacing a raw `EROFS`.

### Wallet messages

The server produces *unsigned* transaction envelopes for Adena and Keplr. The browser hands them to the
wallet, the wallet signs, the network confirms. The server never sees a key, and there is no endpoint that
accepts one.

### Uploads and pinning

Images and metadata are uploaded to IPFS through Octopin or Pinata. The returned CIDs are verified against
the pinned manifest before they enter a collection's metadata, so a collection can never point at artwork
that was not actually stored.

## Frontend

### No build step

`index.html` loads `styles.css` and `app.js` directly. There is no bundler, no transpiler and no dependency
graph, which means the deployed frontend is exactly what is in the repository — and the cache-busting
`?v=` query on both assets is the only cache policy needed.

### Routing

State lives in one object; the router writes the current view into `location.hash`:

| Route | View |
|---|---|
| `#explore` | hero slider, next mints, creator shelf |
| `#upcoming` | the mint schedule with live countdowns |
| `#collections` | the public catalog |
| `#collection?path=…` | one collection: banner, stats, tabs, traits, mint box |
| `#item?id=…&pkg=…` | one edition |
| `#market` | live asks |
| `#portfolio` | wallet balance, tokens, collections |
| `#create` | creator studio (collection form, trust & safety, mint calendar) |
| `#activity` | listings and reward events |
| `#rewards` | quests and points |
| `#settings` | profile, wallets, server configuration |

`routeLocationKey()` serialises the route, `writeRouteLocation()` pushes it, `restoreRouteLocation()` parses
it back. Because the route is in the hash, a refresh restores the exact view, and a static host can serve
the app without rewrite rules.

### Rendering

`render()` is a switch over the route; each view is a template function returning an HTML string. All
user-supplied text goes through `escapeHTML()`; all URLs through `imageSrc()`, which normalises IPFS URIs to
the configured gateway and refuses anything unexpected.

### Delegated events

One document-level click listener dispatches `data-action` and `data-route` targets. Two rules keep it
correct:

- the handler reads `action.dataset`, **not** `event.currentTarget` — in a delegated listener
  `currentTarget` is the document, not the button;
- every `data-action` value has a `case` in the switch, and a test asserts that the two sets stay in sync.

### Live data

The catalog is polled on an interval and re-rendered when the route cares about it. Countdowns tick every
second and are filled immediately after each render, so no placeholder flashes for a second. Wallet data
( balance, portfolio, points ) is fetched on connect and on an explicit refresh.

## Data that never leaves the server

- allowlist addresses — only the count is published;
- wallet keys — never requested, never stored;
- upload limits and moderation records — server-side counters.

## Testing

| Layer | What it covers |
|---|---|
| static analysis | `node --check` on every script |
| source preflight | asset counts, pinned CID checksums, contract invariants, release packaging |
| server tests | live API against a scratch store: empty catalog, whitelist parsing and caps, balance shapes, portfolio scan list |
| UI tests | markers that keep the navigation, the design tokens and the reachable routes in sync |

The scratch store is a temp file; tests never touch the real `data/store.json`.
