# StockIQ test workspace

A working draft of the StockIQ branch ordering interface with the NHS dm+d catalogue and isolated test orders. It reproduces the main tabs and Advanced/Tools navigation using a verified reference release and simulated pharmacy stock.

**This is a sandbox, not a production ordering system.** No order goes to a supplier, no original branch stock is changed and no production login details are included. All order IDs start with `TEST-`.

## Run locally

Requires Node.js 22 or newer. No packages need installing; the catalogue is included in the source download.

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
4. Submit a test order, receive all or part of it in **Goods In**, and check stock/history.

Medicine and pack data are real reference records. Supplier costs and stock are simulated: newly imported packs use an explicitly labelled £1 test cost and start at zero shelf stock. Tariff/list reference prices are shown separately and are not wholesale quotations. Quantities entered for orders/receipts are whole packs; the dm+d quantity/unit describes the contents of one pack.

**Sample products** is a separate, explicitly selected source. No failed real-data search silently substitutes synthetic matches.

The interface also includes Auto Orders, Branch Usage, Fast Lines targets, Delivery Times, Stock Count, Smart Orders, Surplus, Needs Attention, local reference-image/CSV import, Stock Feedback, Saved Drafts, Order Analytics and an API Test Console.

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

Intended repository: `https://github.com/Mostafadmg/StockIQ`. Nothing has been pushed to that GitHub repository. The hosted draft's **Download source** link provides a complete ZIP, including the catalogue.

```sh
git init -b main
git add .
git commit -m "Add StockIQ isolated ordering draft"
git remote add origin https://github.com/Mostafadmg/StockIQ.git
git push -u origin main
```

Production supplier ordering, transactional stock, PMR, role-based access, automated OCR and trained forecasting remain future integrations. The demo does not imply those connections exist.
