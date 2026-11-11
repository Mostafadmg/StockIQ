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
| `src/basket-review.js`, `src/basket-review.css` | Full-page `/review` basket, supplier groups, selection, sorting and responsive fixed footer |
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

Manual medicine names use `choose-manual-product` and the picker's `cleanup.openProduct(record,{quantity})` method, so search results and order-list medicines open the same direct-send/basket modal. Each pack also has a separate quantity and direct **Add to basket** control; that action imports the selected pack if needed and updates only the basket, without opening the modal or submitting an order. The compact catalogue source/provenance disclosure keeps reference details available without filling the mobile screen. Secondary header controls remain in the account menu on small screens.

The DOM regression tests mount the real picker and app with Linkedom; gesture tests cover a completed touch selection versus a scroll/cancel and duplicate click suppression. Browser visual QA is separate from these tests.

Basket entry points navigate to `/review` rather than opening a modal. Review refreshes are read-only; quantity/supplier edits and removal preserve the current page, notes and selection. With an explicit selection, cascade submission creates test orders only for those basket lines and leaves other lines untouched. Draft restoration returns to review. See `docs/basket-parity.md` for the original-source evidence and browser verification limits.

Supplier quote checks use `POST /api/orders/quote`. Manual quote calls are serialized, debounced and discarded when input changes. Catalogue import resolves once per selection; direct sending retains its own retry ID. All delivery calendars share `server/fulfilment.mjs`, served as a same-origin module for the Delivery Times view. Dates use Europe/London, including BST; configured van offsets are working days and skip weekends and England/Wales bank holidays. Historical acceptance and arrival estimates stay fixed after creation. Partial or unavailable packs never become stock during receipt.

## Reference lookup API

The read-only GTIN reference lookup remains available for development through `server/gtin.mjs` and `src/barcode.js`. It has no scanner UI or device connection in the app. Hardware scanning, keyboard barcode entry and serial transport have been removed from Manual Orders. The API reference and parser/catalogue checks describe the remaining isolated reference endpoint.

`src/manual-comparison.css` contains only the supplier comparison presentation used by the order modal.

Visual parity uses two final stylesheets: `src/reference-theme.css` supplies the original shared tokens/header/controls and supplier brand palette; `src/reference-pages.css` supplies page-specific compact layouts and states. They load after all prior UI layers. Use the source evidence in `docs/visual-reference.json` before changing these values. The functional modal/direct-send/quick-add code is independent of this final styling layer.

Manual Orders intentionally departs from the source screenshot following the owner’s UI request: it uses a single-column layout and a padded search card, and omits the Workspace products sidebar. Shared navigation and supplier brand colours remain unchanged.

Manual Orders renders `#manual-order-items` with `renderManualItems(state,{escape,money})` from `src/views.js`. Basket and direct-send success callbacks replace only this list and update the totals, leaving the mounted picker and open modal intact. Initial rendering uses the same helper. Rows derive from current basket entries and saved order-line snapshots, including sample products, rather than every catalogue import. Quote-only imports do not create an order-item row.

`renderManualItems` also accepts `tab`, `busy`, `error`, `notice`, `needsReview` and an explicit `selected` Set. Manual-page toggles update only the panel, with Ordered as the default. Accepted and rejected quantities are separate views of immutable order lines; unconfirmed acceptance remains pending. Inline basket edits use the existing PATCH/DELETE routes; explicit submission uses `/api/orders/cascade` with each saved line’s chosen wholesaler and stays on `/daily-orders`. Invalid or failed edits require a corrected save or restoring the saved basket before submission. The global mutation guard prevents stale or duplicate sends. The full `/review` page remains available.

Delivery vans may have an optional `depot` label (trimmed, maximum80characters). The selected dated delivery estimate carries `delivery.depot` through quote/comparison and order snapshots; older snapshots omit it. Historical depot labels survive later settings changes. `src/delivery-status.js` classifies valid working-day estimates for the shared green/yellow/neutral badges; it must not coerce missing day counts into same-day delivery or infer a Birmingham route from the wholesaler.

The compact modal styling is scoped in `src/manual-compact.css`, loaded last. Supplier offers share one selectable list, with viewport-based pagination rather than a tall scrolling dialog. More options replaces the list temporarily; quantity, selected supplier and order attempts remain intact. Read-only `GET /api/dmd/brands?id=...&type=AMPP|VMPP` returns selected-first exact VMPP-family packs with real brand/manufacturer names, bounded to60 with total/truncated metadata. It does not import every alternative, choose a brand automatically or manufacture supplier prices. Selecting a brand refreshes quotes for that exact pack identifier.

Basket selection is shared by Manual Orders and `/review`: initially all IDs, new IDs selected, removed IDs pruned, and existing unchecked IDs preserved through edits/navigation. Empty means none and never submits. Both totals use the selected subset. Supplier triggers use a detached `mountManualSearch({mode:'basket',onSave,...})` instance that reuses the compact offer list without replacing the main medicine picker. It quotes/compares existing workspace product IDs directly, locks the exact pack, and saves quantity plus supplier in one PATCH only on explicit confirmation. Failed saves remain open; cancellation, cleanup and navigation invalidate pending modal callbacks. No direct order or catalogue import is involved.
