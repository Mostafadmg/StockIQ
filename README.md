# StockIQ test workspace

A working draft of the StockIQ branch ordering interface, built from read-only observation of the owner's site. It reproduces the main tabs and Advanced/Tools navigation with synthetic products and an isolated test API.

**This is a sandbox implementation, not the original source code or a production replacement.** Supplier ordering, live stock/pricing, PMR, OCR and trained AI integrations are not connected. No production account details are included. All order IDs start with `TEST-` and no order leaves this workspace.

## Run locally

Requires Node.js 22 or newer. No packages need installing.

```sh
npm run build
npm test
npm start
```

Open `http://localhost:3000`. Deep links such as `/daily-orders`, `/inventory` and `/history` work. The API is served by the same application.

## Try the core flow

1. Add sample products from **Auto Orders** or **Manual Orders**.
2. Open the basket and **Submit test order**.
3. Open **Goods In**, receive all or part of the delivery, and check the sample stock count.
4. Check **History**, **Analytics**, saved drafts and test claims.
5. Open **Tools → API Test Console**. **Run test suite** uses another isolated workspace, leaving your demo basket alone.

The interface also includes Branch Usage, Fast Lines targets, Delivery Times, Stock Count, Smart Orders, Surplus, Needs Attention, Screenshot Import with local reference image preview and reviewed CSV/text lines, Stock Feedback and Order Analytics.

## Architecture and persistence

- `src/`: dependency-free browser UI and styles.
- `server/api.mjs`: validated sandbox REST API; no outbound network calls.
- `server/local.mjs`: Node HTTP adapter for the same built Worker.
- `scripts/build.mjs`: deterministic bundling into a Worker ES module with embedded assets.
- `tests/`: API flow, isolation, validation, view and built artifact tests.
- `docs/api-reference.json`: endpoint contracts and examples.
- `docs/feature-coverage.md`: observed interface coverage and remaining integration work.

A random workspace ID separates each browser's sample records. The API uses bounded in-memory sessions; the UI saves its sample snapshot in browser local storage and restores it after server restarts or eviction. **This is device-local test storage, not a durable pharmacy database.** Use Export workspace JSON to retain a copy. Browser preferences and sample data survive page refresh; another browser starts a new workspace. Reset affects only the active test workspace.

The hosted draft is owner-private. Its content security policy permits same-origin API requests only. The request builder rejects external URLs. This sandbox ID is not a production authentication or authorization design.

## API example

```sh
curl http://localhost:3000/api/health
curl -X POST http://localhost:3000/api/workspaces \
  -H 'Content-Type: application/json' -d '{"id":"my-test-workspace"}'
curl -X POST http://localhost:3000/api/basket \
  -H 'Content-Type: application/json' -H 'x-workspace-id: my-test-workspace' \
  -d '{"productId":"p001","quantity":2}'
curl -X POST http://localhost:3000/api/orders \
  -H 'Content-Type: application/json' -H 'x-workspace-id: my-test-workspace' \
  -d '{"notes":"Sandbox check"}'
```

## GitHub handoff

The intended repository is `https://github.com/Mostafadmg/StockIQ` (empty when inspected). This draft is prepared as a source checkout and downloadable archive. Nothing has been pushed to that GitHub repository.

To initialize a clean copy after downloading:

```sh
git init -b main
git add .
git commit -m "Add StockIQ isolated ordering draft"
git remote add origin https://github.com/Mostafadmg/StockIQ.git
git push -u origin main
```

For a durable production version, connect authenticated role-based access, a transactional database, stock/product master data, supplier-specific sandbox credentials and contract tests, audited receipts/claims, and the actual PMR and forecasting services. These are follow-on integrations, not features implied by the demo.
