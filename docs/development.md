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
| `src/serial-scanner.js` | Read-only Web Serial scanner transport, scan framing and connection cleanup |
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

Manual medicine names use `choose-manual-product` and the picker's `cleanup.openProduct(record,{quantity})` method, so search results and existing workspace products open the same direct-send/basket modal. Each pack also has a separate quantity and direct **Add to basket** control; that action imports the selected pack if needed and updates only the basket, without opening the modal or submitting an order. The compact catalogue source/provenance disclosure keeps reference details available without filling the mobile screen. Secondary header controls remain in the account menu on small screens.

The DOM regression tests mount the real picker and app with Linkedom; gesture tests cover a completed touch selection versus a scroll/cancel and duplicate click suppression. Browser visual QA is separate from these tests.

Basket entry points navigate to `/review` rather than opening a modal. Review refreshes are read-only; quantity/supplier edits and removal preserve the current page, notes and selection. With an explicit selection, cascade submission creates test orders only for those basket lines and leaves other lines untouched. Draft restoration returns to review. See `docs/basket-parity.md` for the original-source evidence and browser verification limits.

Supplier quote checks use `POST /api/orders/quote`. Manual quote calls are serialized, debounced and discarded when input changes. Catalogue import resolves once per selection; direct sending retains its own retry ID. All delivery calendars share `server/fulfilment.mjs`, served as a same-origin module for the Delivery Times view. Dates use Europe/London, including BST; configured van offsets are working days and skip weekends and England/Wales bank holidays. Historical acceptance and arrival estimates stay fixed after creation. Partial or unavailable packs never become stock during receipt.

## Connected barcode scanners

The keyboard-scanner workflow follows the approach inspected read-only in `Mostafadmg/mellonsdaily` at `76ddd733c25374e53afd28bb0baa0f2c3f63d5e2`. Devices already in USB HID keyboard mode use Ready to scan and an Enter or Tab suffix, preserving GS1 FNC1/group separators (ASCII29 / Ctrl+]). The app does not intercept typing in other controls or program the scanner.

The user's Newland is instead shown as USB CDC on COM7. `src/serial-scanner.js` provides a separate, explicit Web Serial chooser and read-only stream transport. Cancel, page exit and component cleanup release the browser's port. The parent retains the picker across modal closes while a serial session is active. This cannot override Proscript's COM-port ownership or reconnect Proscript automatically. No driver settings, device configuration commands or serial writes are used. See `docs/serial-scanner.md` for connection prerequisites, framing and physical-test limitations.

`src/barcode.js` validates EAN/UPC/GTIN and decodes GS1 AI01/02,17,10,21 and37. Expiry YY uses the year within the current year minus50 through plus49; DD00 is the final day of the month. Variable data is never split by guessing a hidden application identifier; missing separators leave expiry unknown and may raise a review warning. AI02 container codes require explicit pack confirmation and never infer pack count.

`server/gtin.mjs` reads `data/dmd-gtin.json`:72,882 validated GTINs tied only to active AMPP packs. It prefers current NHS associations and flags historical fallback for older shelf boxes. It returns every ambiguous pack, requiring a user choice. `data/dmd-gtin-release.json` records source and dataset hashes. Rebuild with `python scripts/prepare-gtin.py --input /path/to/f_gtin2.xml --catalogue data/dmd-catalogue.json --output data`. Original NHS XML and download credentials stay outside Git.

Barcode lookup and supplier comparison are read-only POSTs; their returned snapshots must not overwrite newer client state. Scan metadata stays in the open modal only. Raw scans and serial identifiers are not persisted in the workspace or returned by the barcode API. Scanning does not add to basket, place orders, create expiry records or create retrievals. These are separate, explicit actions.

Visual parity uses two final stylesheets: `src/reference-theme.css` supplies the original shared tokens/header/controls and supplier brand palette; `src/reference-pages.css` supplies page-specific compact layouts and states. They load after all prior UI layers. Use the source evidence in `docs/visual-reference.json` before changing these values. The functional modal/direct-send/quick-add/scanner code is independent of this final styling layer.
