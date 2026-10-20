# Design system — Gnotbook

The interface is **refined technical**, not playful. It should read like a well-made instrument: quiet
surfaces, hairline rules, numbers in monospace, one warm accent that means "this is the action".

## Tokens

Everything is driven by CSS custom properties in `public/styles.css`.

| Token | Value | Role |
|---|---|---|
| `--bg` | `#0A0B0D` | page |
| `--surface` | `#121417` | panels, cards |
| `--surface-2` | `#16191D` | nested blocks, inputs |
| `--surface-3` | `#1C2026` | pressed states, tracks |
| `--line` | `#22262D` | hairline borders (1px) |
| `--line-2` | `#2E333B` | emphasised borders |
| `--text` | `#E9EBEE` | primary text |
| `--text-2` | `#A7ADB7` | secondary text |
| `--text-3` | `#767D88` | labels, meta |
| `--accent` | `#F0B429` | brand, primary action, live state |
| `--live` / `--warn` / `--danger` / `--info` | green / amber / red / blue | on-chain states only |
| `--radius` | `4px` | cards (3px controls, 2px chips) |

The palette is deliberately **not** one hue family: neutral greys carry the UI, the warm amber carries intent,
and the four state colours are reserved for chain facts. Nothing else is coloured.

## Type

- **Inter Tight** — headings and display text, tight tracking (`-.025em`).
- **Inter** — interface copy.
- **JetBrains Mono** — every number, address, timestamp, count and index. If a value can be compared or
  copied, it is monospace.

Sizes are small and dense on purpose: the user scans grids of collections, not paragraphs.

## Layout

- **Topbar** (56px): brand, search, network, wallet. Sticky, translucent, hairline bottom border.
- **Icon rail** (60px): fixed left column; expands to 224px on hover and slides the labels in. Below 980px
  it becomes an off-canvas drawer with a backdrop and a scroll lock.
- **Main**: browse pages fill the viewport width; task pages cap their working column (create form 860px,
  settings 1080px) so inputs stay readable.
- **Mint page**: two columns — items, tabs and traits on the left, a sticky mint box on the right (360px).

## Signature: the index

Section headers carry a monospace index — `01 / NEXT MINTS`, `02 / COMMUNITY COLLECTIONS`. It gives the
page a reading order and keeps the hierarchy legible without heavy headings.

## Components

- **Buttons**: 3px radius, 1px border, `--accent` fill for the single primary action per view; everything
  else is a quiet surface or an outline. A card never shows two filled buttons — the second action is a
  text link, so the accent keeps its meaning.
- **Chips**: 2px radius, monospace, uppercase, with a 5px state dot. Used for live / scheduled / ended /
  draft and for supply labels.
- **Cards**: 1px border, no shadow at rest, 1px lift on hover, 16:9 or 1:1 cover.
- **Stat rows**: a hairline table (1px gaps over a `--line` background) instead of separate boxes.
- **Empty states**: a bordered panel with a plain glyph, a plain sentence, and the next action.
- **Inputs**: 3px radius, 1px border, focus turns the border amber.

## Content states

Every state is designed, not accidental:

| State | Behaviour |
|---|---|
| Loading | a static boot skeleton in the HTML shell holds the first paint |
| Empty | the hero explains that the stage is empty on purpose and offers the create action |
| Partial | a collection without a mint date says “Mint date not set” instead of faking a countdown |
| Error | a toast with the specific reason; the form keeps the entered values |
| Success | a toast naming what happened, then the route moves to the new collection |
| Permission | without a wallet the portfolio explains self-custody and offers to connect |

## Motion

Minimal and purposeful: 120–200ms on hover and route changes, a 500ms slide on the hero, and a global
`prefers-reduced-motion` override that removes animation and transitions entirely.

## Responsive

- ≥ 980px: rail visible, multi-column grids, hero arrows.
- < 980px: rail becomes a drawer, grids collapse, the hero keeps room for the dots.
- < 560px: single column, brand wordmark hidden, hero arrows hidden.

## Review process

The design is reviewed against a written contract, and the rendered evidence is kept in
[`design-review/`](design-review/): a screenshot per content state per viewport, plus a JSON record that the
`frontend-design-direction` skill's checker validates. Source inspection alone does not pass that gate — the
screenshots have to be looked at.
