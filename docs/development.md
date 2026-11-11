# Working on StockIQ

Use Node.js 22 or newer. Run `npm ci` to install the DOM-test development dependencies; the application and Worker have no runtime package dependencies.

```sh
npm ci
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
| `src/manual-search.js` | Accessible dm+d picker and item-order modal, success/error/retry states |
| `src/manual-orders.js` | Separate direct-send and basket API paths; updates totals without destroying the modal |
| `src/parity.css` | Original shell, dense controls, tables, responsive/dark styles |
| `src/ui-polish.css` | Final mobile-first visual layer: typography, touch targets, headers, cards, responsive tables and dialogs |
| `src/parity-views.css` | Original page-specific layouts |
| `src/styles.css`, `src/views.css`, `src/manual-search.css` | Base styles beneath the parity layers |
| `src/order-summary.js` | Shared acceptance, supplier, quantity and arrival summaries for basket/results/details |
| `server/fulfilment.mjs` | Shared London-time delivery calendar, simulation acceptance and immutable snapshot validation |
| `server/api.mjs` | Sandbox data validation, actions, calculations and snapshot schema |
| `server/dmd-local.mjs` | Indexed compressed NHS catalogue lookup |
| `data/dmd-catalogue.json` | Verified release shards and prefix/identifier indexes |
| `scripts/build.mjs` | Deterministic Worker, linked assets and downloadable source packaging |
| `tests/` | API, identity, restoration, UI/action contracts and built artifact checks |

## State and API

Workspace version1 snapshots remain backward-compatible. New optional `features` fields cover vans, fast targets, reviews, waste, goods settings, support and surplus. Every mutation is validated before changing stock. All writes target only the supplied test workspace.

For stateless hosting the browser sends `POST /api/dispatch` with `{id,workspace,method,path,data}`. The server restores and validates the snapshot, performs one logical local API call, and returns its status/data/workspace. GET results and read-only quote/cascade POST results do not overwrite newer browser state. Direct REST routes remain available for local development. Do not introduce calls to the original ordering system while wiring production adapters.

The source is published to the owner's StockIQ GitHub repository. Sites hosting uses the separate repository credential and the exact same authored source commit/artifact. Runtime credentials, browser profiles and the TRUD key must never enter source control.

Direct item submission uses `POST /api/orders/direct` with `{productId,quantity,supplier,notes,requestId}`. It creates one line and leaves the basket and shelf stock untouched. A repeated request ID with the same normalized payload replays its existing result; changed payloads require a new request ID. This retry protection is scoped to the browser workspace snapshot. The modal retains its key after an error and prevents duplicate clicks. Direct orders appear in History and Goods In alongside basket orders.

Manual workspace-product cards use `choose-manual-product` and the picker's `cleanup.openProduct(record,{quantity})` method, so search results and existing workspace products open the same direct-send/basket modal. The compact catalogue source/provenance disclosure keeps reference details available without filling the mobile screen. Secondary header controls remain in the account menu on small screens.

The DOM regression tests mount the real picker and app with Linkedom; gesture tests cover a completed touch selection versus a scroll/cancel and duplicate click suppression. Browser visual QA is separate from these tests.

Supplier quote checks use `POST /api/orders/quote`. Manual quote calls are serialized, debounced and discarded when input changes. Catalogue import resolves once per selection; direct sending retains its own retry ID. All delivery calendars share `server/fulfilment.mjs`, served as a same-origin module for the Delivery Times view. Dates use Europe/London, including BST; configured van offsets are working days and skip weekends and England/Wales bank holidays. Historical acceptance and arrival estimates stay fixed after creation. Partial or unavailable packs never become stock during receipt.
