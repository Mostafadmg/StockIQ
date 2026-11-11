# Working on StockIQ

Use Node.js 22 or newer. No dependency install is required.

```sh
npm run check
npm run build
npm test
npm start
```

The local app runs at http://localhost:3000. `PORT` selects another loopback port. Rebuild after source changes; `npm start` serves the compiled Worker, not a separate implementation.

## Files to change

| File | Purpose |
| --- | --- |
| `src/app.js` | Application shell, routing, workspace snapshot, core basket/receipt dialogs and events |
| `src/views.js` | Page markup and derived read models for tabs and subviews |
| `src/parity-actions.js` | Delivery vans, Fast Lines, reviews, claims, waste, support, surplus and cascade interactions |
| `src/manual-search.js` | Accessible dm+d medicine/pack picker |
| `src/parity.css` | Original shell, dense controls, tables, responsive/dark styles |
| `src/parity-views.css` | Original page-specific layouts |
| `src/styles.css`, `src/views.css`, `src/manual-search.css` | Base styles beneath the parity layers |
| `server/api.mjs` | Sandbox data validation, actions, calculations and snapshot schema |
| `server/dmd-local.mjs` | Indexed compressed NHS catalogue lookup |
| `data/dmd-catalogue.json` | Verified release shards and prefix/identifier indexes |
| `scripts/build.mjs` | Deterministic Worker, linked assets and downloadable source packaging |
| `tests/` | API, identity, restoration, UI/action contracts and built artifact checks |

## State and API

Workspace version1 snapshots remain backward-compatible. New optional `features` fields cover vans, fast targets, reviews, waste, goods settings, support and surplus. Every mutation is validated before changing stock. All writes target only the supplied test workspace.

For stateless hosting the browser sends `POST /api/dispatch` with `{id,workspace,method,path,data}`. The server restores and validates the snapshot, performs one logical local API call, and returns its status/data/workspace. GET results do not overwrite newer browser state. Direct REST routes remain available for local development. Do not introduce calls to the original ordering system while wiring production adapters.

The source is published to the owner's StockIQ GitHub repository. Sites hosting uses the separate repository credential and the exact same authored source commit/artifact. Runtime credentials, browser profiles and the TRUD key must never enter source control.
