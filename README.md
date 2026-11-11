# StockIQ test workspace

A reconstruction of the StockIQ branch app from read-only inspection of the website, with its compact layout, navigation, screens and local test workflows. It includes the verified NHS dm+d catalogue and an isolated order/stock API. The original server implementation was not supplied; supplier integrations and forecasting rules are reconstructed test behavior, not a copy of that backend.

**This is a sandbox, not a production ordering system.** No order goes to a supplier, no original branch stock is changed and no production login details are included. All order IDs start with `TEST-`.

## Run locally

Requires Node.js 22 or newer. The catalogue is included in the repository and source download. Install the small DOM-test development dependencies with `npm ci` before running the checks. GitHub Actions runs syntax, build and automated checks on pushes and pull requests.

```sh
npm ci
npm run build
npm test
npm start
```

Open `http://localhost:3000`. Deep links including `/daily-orders`, `/inventory` and `/history` work.

## Manual ordering with NHS dm+d

1. Open **Manual Orders** and type at least two characters, such as `amoxicillin 500` or a brand name.
2. Set the quantity beside a matching pack and use **Add to basket** to add it directly. The same shortcut is available in the order-items list below search. This does not open a modal or send an order.
3. Alternatively, choose the medicine name to open its ordering modal, showing the NHS identifier, pack, manufacturer and available reference price. Set the pack quantity and test supplier. **Send now** creates an order for only that item and shows the result inside the modal, without changing the existing basket. **Add to basket** is also available inside the modal.
4. Open **Basket** to navigate to the full **Order review** page at `/review`. Edit quantities and test suppliers, sort or remove lines, and save a draft. With no explicit selection, all ready lines are included; select lines to submit only those and keep the rest in the basket. **Submit to wholesalers** creates only isolated test orders. Receive test orders in **Goods In** to update test shelf stock.

Medicine and pack data are real reference records. Supplier costs and stock are simulated: newly imported packs use an explicitly labelled £1 test cost and start at zero shelf stock. Tariff/list reference prices are shown separately and are not wholesale quotations. Quantities entered for orders/receipts are whole packs; the dm+d quantity/unit describes the contents of one pack.

**Sample products** is a separate, explicitly selected source. No failed real-data search silently substitutes synthetic matches.

The original main tabs and menus are reproduced:

- Auto Orders: pending/fast/OTC lines, shelf counts, selections and basket actions.
- Manual Orders: searchable dm+d packs, Ordered, Rejected / unobtainable and Basket tabs and a fixed basket summary.
- Goods In: supplier cards, receipt queue and invoice references, Claims, Analytics and Settings.
- History: grouped order/line timeline, status/supplier/date filters, reorder and spend summary.
- Advanced: Branch Usage, Fast Lines, Delivery Times, Stock Count, Smart Orders, Analytics and Surplus.
- Tools: Needs Attention, Screenshot Import, Stock Feedback, Saved Drafts and Order Analytics.

Fast Lines supports cover, rounding and manual/auto targets. Delivery Times supports multiple vans, running days and arrival offsets. Weekly feedback separates stockouts/overstocks. Waste adjusts test stock; claims have workflow statuses and credits; surplus supports offer → request → dispatch → confirm → statement. The account menu contains source download, workspace settings, appearance/text-size controls, support, surplus, a demo sign-in screen and the developer API console. Mobile screens use larger touch targets, readable controls and compact disclosures; selecting a search result or an item below search opens the same ordering modal.

See `docs/parity.md` for feature coverage and `docs/development.md` for the code layout.

## NHS reference data

- Source: NHS TRUD item 24, release **9 November 2026**, Release 11.1.0.
- Active packs: **145,806** (109,524 AMPP and 36,282 VMPP).
- Actual NHS identifiers are preserved as strings. Discontinued, invalid and unavailable packs are excluded; reinstated packs remain searchable.
- Product/pack relations, generic medicine names, canonical quantities/units, manufacturers and available tariff/list references are preserved.
- `data/dmd-release.json` pins the official archive checksum, dataset checksum and counts.
- `data/dmd-catalogue.json` contains indexed gzip shards. The Worker decodes only candidate shards instead of loading the entire expanded XML or catalogue into memory.
- Your TRUD API key was used only to retrieve the subscribed reference release. It is not included in source, the browser or the deployment.

This is a dated release snapshot. It does not automatically refresh or report supplier stock. No external database or credentials are needed to search the bundled release. `scripts/prepare-dmd.py` can regenerate the sharded dataset from active-pack NDJSON produced by a dm+d XML extractor. Python is needed only for that optional preparation step, not for running the app.

Older tariff-only workspace snapshots remain supported. The default search uses the bundled NHS dm+d data and does not depend on the former Mellons Supabase endpoint.

## Architecture and persistence

- `src/`: browser UI, styles and keyboard-accessible medicine picker.
- `server/api.mjs`: validated sandbox order/stock API.
- `server/dmd-local.mjs`: bounded indexed lookup of the NHS snapshot.
- `server/dmd.mjs`: catalogue adapter, including legacy tariff compatibility.
- `server/local.mjs`: Node HTTP adapter for the same built Worker.
- `scripts/build.mjs`: deterministic dependency-free Worker packaging with embedded assets.
- `tests/`: validation, catalogue identity, lookup, tab, built artifact and order/receipt checks.
- `docs/api-reference.json`: endpoint contracts and examples.

The browser saves its isolated workspace snapshot locally and sends that snapshot with each logical API request through `POST /api/dispatch`. This works even when the host starts a fresh Worker instance for every request. Read-only searches do not overwrite newer basket/stock changes. Export workspace JSON to retain a copy; another browser starts a new test workspace. Reset affects only the active workspace. This is device-local test storage, not a durable pharmacy database or production authentication design.

Hosted access follows the site's sharing settings. Browser API requests are restricted to the same origin. Source ZIP downloads include the verified catalogue and application code, without credentials or browser state.

## API examples

```sh
curl http://localhost:3000/api/health
curl -X POST http://localhost:3000/api/workspaces \
  -H 'Content-Type: application/json' -d '{"id":"my-test-workspace"}'
curl 'http://localhost:3000/api/dmd/search?q=amoxicillin%20500' \
  -H 'x-workspace-id: my-test-workspace'
curl -X POST http://localhost:3000/api/catalogue/import \
  -H 'Content-Type: application/json' -H 'x-workspace-id: my-test-workspace' \
  -d '{"id":"1477411000001105","type":"AMPP"}'
```

`GET /api/catalogue/status` reports the loaded release/counts. `GET /api/dmd/packs?id=...&type=AMPP` looks up a specific pack. Hosted clients should use the stateless dispatch envelope; direct REST routes are also available for development sessions.

## GitHub handoff

Repository: `https://github.com/Mostafadmg/StockIQ`. The hosted draft's **Download source** link also provides a complete ZIP, including the catalogue.

```sh
git clone https://github.com/Mostafadmg/StockIQ.git
cd StockIQ
npm ci
npm run build
npm start
```

Production supplier ordering, transactional stock, PMR, role-based access, automated OCR and trained forecasting remain future integrations. The demo does not imply those connections exist.

Order results show the supplying test wholesaler, supplier reference, requested/accepted/unavailable packs and a London-time estimated arrival. Try full, partial and unavailable responses from the manual modal’s **Test response** disclosure. Delivery Times controls the shared schedule estimates; offsets count working days, excluding weekends and England/Wales bank holidays. Goods In checks in only accepted packs. All supplier prices, availability and order responses remain simulations.

Supplier comparison reports the lowest test total for the full pack quantity and breaks price ties using the earliest known delivery estimate. Current supplier prices may all tie; reference/list prices from dm+d remain separate from simulated supplier costs.


Manual Orders uses a focused single-column layout with a padded medicine-search card. The scanner section and Workspace products sidebar have been removed. Medicine names open ordering options; adjacent Add to basket controls remain available. Items actually added to the basket or submitted as orders appear below search immediately, including sample products. Ordered opens by default; Rejected / unobtainable shows unsupplied packs, and Basket holds unsent lines. Tab counts are medicine-line counts. Partial orders show accepted packs under Ordered and only the unaccepted packs under Rejected. The Basket tab lets you edit quantities and wholesalers, remove items and explicitly send the test basket without leaving Manual Orders. The bottom View basket button opens this tab; the header basket still provides the full review page. Preview-only catalogue imports are excluded. Quantity editing keeps the dropdown open and preserves entered pack counts.
