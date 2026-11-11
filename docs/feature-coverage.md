# StockIQ sandbox feature coverage

This draft reconstructs the observed StockIQ navigation and demonstrates its main pharmacy ordering workflows using synthetic records. It is a new implementation prepared for review and further development, not a copy of the production backend or a claim of production feature parity.

## Core workflow

The sandbox is designed to support product search, price comparison with sample suppliers, basket editing, saving and resuming drafts, submitting a **test order**, viewing its history, and receiving a **test delivery**. All changes belong to the sandbox. Test submissions never place orders with a pharmacy, wholesaler, or another branch.

The same-origin sandbox API is also available for inspecting requests and exercising the workflow. See `api-reference.json` for the implemented method and path contract. A successful sandbox API check validates this draft only; it does not validate any production API or supplier connection.

## Navigation and page scope

The page names below were observed through read-only inspection. They form the draft's navigation and interaction targets. A navigable page does not imply every production action or underlying algorithm has been reproduced.

| Area | Observed page or subtab | Sandbox scope |
| --- | --- | --- |
| Main | Auto Orders | Sample suggestions, product filtering, selection, quantities, and adding lines to a test basket. |
| Auto Orders | Orders, Fast Lines, OTC | Synthetic product groups; representative counts, statuses, and filters. |
| Main | Manual Orders | NHS medicine search, pack selection, direct basket addition, modal Send now and simulated supplier comparison. |
| Main | Goods In | Test delivery queue and receipt flow linked to sandbox orders. |
| Goods In | Deliveries, Claims | Synthetic deliveries and claim records. No supplier notification or credit processing. |
| Goods In | Analytics, Settings under More | Nested navigation targets; representative local configuration and summaries. |
| Main | History | Sandbox orders, status filtering, supplier/date/search filters, and reordering into the test basket. |
| History | Everything, Rejected, To follow, Awaiting | Sample order outcomes and status views. |
| Advanced | Branch Usage | Searchable usage metrics and representative mover/classification filters. |
| Advanced | Fast Lines | Sample cover, rounding, and target configuration. |
| Advanced | Delivery Times | Sample supplier vans, cutoff times, and arrival schedules. |
| Advanced | Stock Count | Synthetic shelf counts and inventory records. |
| Stock Count | Overview, To count, History, Count | Representative count queue, coverage metrics, and test count workflow. |
| Advanced | Smart Orders | Deterministic sample suggestions and test ordering; no forecasting model. |
| Smart Orders | AI Order, Orders | Sample suggestion/order views. The AI label describes the observed navigation, not a live AI integration. |
| Advanced | Analytics | Sample operational summaries and charts derived from sandbox data. |
| Analytics | Overview, Regret, Waste, Prices, Slow Movers, AI Performance | Representative nested views; illustrative metrics rather than validated production calculations. |
| Advanced | Surplus | Synthetic surplus offers and branch transfer scenarios. No real stock is shared or transferred. |
| Tools | Needs Attention | Sample exceptions that can be reviewed within the test workflow. |
| Tools | Screenshot Import | Import interaction target. Actual OCR/ProScript extraction is not connected. |
| Tools | Stock Feedback | Test stockout/overstock feedback and notes. No model retraining or live review submission. |
| Tools | Saved Drafts | Sandbox baskets saved as drafts and resumed for testing. |
| Tools | Order Analytics | Sample order volume, supplier allocation, spend, and recent submissions. |
| Order Analytics | Overview, Scorecard, Shadow engine | Nested targets using sample analytics; no live routing or shadow engine. |

The 12 Advanced/Tools pages are Branch Usage, Fast Lines, Delivery Times, Stock Count, Smart Orders, Analytics, Surplus, Needs Attention, Screenshot Import, Stock Feedback, Saved Drafts, and Order Analytics.

## Integration boundaries

- **Suppliers and pricing:** names, quotes, stock availability, acknowledgements, and fulfilment outcomes are synthetic. No wholesaler API, account, supplier order, or real concession feed is connected.
- **PMR and prescriptions:** no ProScript/PMR connection, patient record, prescription feed, or live patient owing is imported.
- **OCR and files:** upload controls or sample extraction flows do not establish a connected OCR service. Any extraction simulation must be labelled as a sample.
- **AI and analytics:** forecasts, smart suggestions, scorecards, savings, and shadow-engine results are illustrative. They are not clinical advice or validated production algorithms.
- **Identity:** no production credentials, session cookies, tokens, or branch identifiers belong in the source, fixtures, deployment, or GitHub repository. Demo identity is sandbox-only.
- **Actions:** submit, receive, count, claim, share, feedback, and draft actions affect sandbox data only. No production mutation endpoint is used.

## API and data isolation

Browser requests must use relative `/api/...` paths on the draft's own origin. Do not accept an arbitrary API base URL from query parameters, saved settings, or untrusted content. Do not proxy requests to the original site. Tests and fixtures must remain self-contained and use synthetic records.

The repository is intended as a reviewable starting point. Production parity would require the original source, documented API contracts, supplier test accounts, real authentication and authorization, durable storage, integration tests, and explicit validation of each production workflow.


## Mellons catalogue update

Manual Orders now queries the same `search-drug-tariff` lookup used by the Mellons daily repository. The dropdown includes medicine name and pack size, selection, pack quantity, keyboard navigation, loading/error/empty states and real tariff reference prices. Added packs participate in basket, draft, test order, partial/full receiving, history and stock counts. Lookup is read-only; every order and stock write remains in the clone. The available lookup returns Drug Tariff records without dm+d/SNOMED identifiers; generated pack hashes are internal IDs. Wholesale prices and stock remain simulated. Source/API tests cover this flow; managed browser QA is unavailable in this session.


## NHS TRUD dm+d release integration (supersedes the Mellons lookup dependency)

The default Manual Orders dropdown now searches 145,806 active AMPP/VMPP packs from the verified 9 November 2026 NHS TRUD release. Actual identifier strings, quantities, units, brand/manufacturer, generic relations and available list/tariff prices are preserved. Discontinued/invalid records are excluded. Snapshot shards are bundled and searched without the unavailable Supabase project. The source ZIP includes these data files; the TRUD key is absent. Search, exact-pack selection, import, test basket/order, receiving and stock have automated coverage. Supplier ordering and stock remain simulated; no automatic reference-refresh schedule is configured.
