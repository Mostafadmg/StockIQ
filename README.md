# StockIQ test workspace

A reconstruction of the StockIQ branch app from read-only inspection of the website, with its compact layout, navigation, screens and local test workflows. It includes the verified NHS dm+d catalogue and an isolated order/stock API. The original server implementation was not supplied; supplier integrations and forecasting rules are reconstructed test behavior, not a copy of that backend.

**This is a sandbox, not a production ordering system.** No order goes to a supplier, no original branch stock is changed and no production login details are included. All order IDs start with `TEST-`.

## Run locally

Requires Node.js 22 or newer. No packages need installing; the catalogue is included in the repository and source download. GitHub Actions runs syntax, build and automated checks on pushes and pull requests.

```sh
npm run build
npm test
npm start
```

Open `http://localhost:3000`. Deep links including `/daily-orders`, `/inventory` and `/history` work.

## Manual ordering with NHS dm+d

1. Open **Manual Orders** and type at least two characters, such as `amoxicillin 500` or a brand name.
2. Choose a matching AMPP or VMPP pack from the dropdown. Actual NHS identifiers, pack sizes, manufacturers and available reference prices are shown.
3. Enter the number of packs and **Add to test basket**.
4. Open **Review & Cascade**, compare simulated supplier allocations and submit one or more test orders. Receive all or part in **Goods In**, and check stock/history.

Medicine and pack data are real reference records. Supplier costs and stock are simulated: newly imported packs use an explicitly labelled £1 test cost and start at zero shelf stock. Tariff/list reference prices are shown separately and are not wholesale quotations. Quantities entered for orders/receipts are whole packs; the dm+d quantity/unit describes the contents of one pack.

**Sample products** is a separate, explicitly selected source. No failed real-data search silently substitutes synthetic matches.

The original main tabs and menus are reproduced:

- Auto Orders: pending/fast/OTC lines, shelf counts, selections and basket actions.
- Manual Orders: searchable dm+d packs, reference sidebar and fixed Continue summary.
- Goods In: supplier cards, receipt queue and invoice references, Claims, Analytics and Settings.
- History: grouped order/line timeline, status/supplier/date filters, reorder and spend summary.
- Advanced: Branch Usage, Fast Lines, Delivery Times, Stock Count, Smart Orders, Analytics and Surplus.
- Tools: Needs Attention, Screenshot Import, Stock Feedback, Saved Drafts and Order Analytics.

Fast Lines supports cover, rounding and manual/auto targets. Delivery Times supports multiple vans, running days and arrival offsets. Weekly feedback separates stockouts/overstocks. Waste adjusts test stock; claims have workflow statuses and credits; surplus supports offer → request → dispatch → confirm → statement. The account menu contains source download, workspace settings, a demo sign-in screen and the developer API console.

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

The hosted draft remains owner-private. Browser API requests are restricted to the same origin. Source ZIP downloads include the verified catalogue and application code, without credentials or browser state.

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
npm run build
npm start
```

Production supplier ordering, transactional stock, PMR, role-based access, automated OCR and trained forecasting remain future integrations. The demo does not imply those connections exist.
