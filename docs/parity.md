# StockIQ interface and workflow coverage

The client was reconstructed from read-only inspection of the owner's website. All observed primary navigation entries and Advanced/Tools pages are present. The original source and backend rules were not available. This document distinguishes matching interface structure from operational integrations.

| Area | Implemented interface and test behavior |
| --- | --- |
| Shell | Original logo, compact sticky header, violet active pills, clock, branch name, support/truck/alerts/text/theme/basket/account controls; responsive menu and demo sign-in page |
| Auto Orders | Orders/Fast Lines/OTC tabs; compact product table; selections, dismissal, editable shelf counts, add lines |
| Manual Orders | Left medicine lookup and selected packs, right reference-price cards, fixed supplier/total/Continue bar; real dm+d matching; selection modal with Send now and Add to basket plus in-modal result |
| Basket | Editable quantities, remove/save draft, Review & Cascade, per-line supplier selection and atomic split test orders |
| Goods In | Deliveries/Claims and More → Analytics/Settings; supplier cards, attention queue, Core/wholesaler receipt selection, invoice/date/search filters |
| Claims | Wholesaler/Core filter, draft/submitted/acknowledged/resolved/disputed statuses, dates, values and credits |
| History | Grouped order and line timeline; supplier/status/date/search filters, earlier period, reorders and selected-period spend summary |
| Branch Usage | Categories, movement classes, policy/class/season filters, sort, pagination and details based on the sample workspace |
| Fast Lines | 1/½-week cover, 5/1 rounding, add/remove, auto/manual targets, saved settings |
| Delivery Times | Multiple vans per supplier, weekdays, cutoff/arrival/offset, once/twice-daily presets and saved schedules |
| Stock Count | Overview, To count, History and Count with stock value, coverage, exposure and count variances |
| Smart Orders | AI Order/Orders tabs and an explicitly identified sample stock-target rule |
| Analytics | Overview, Regret, Waste, Prices, Slow Movers and AI Performance; waste entry and sample evaluation |
| Surplus | Count/share offers, local branch transfer request/dispatch/confirm, sent/past transfers and monthly statement |
| Needs Attention | Low-stock review and order-line actions |
| Screenshot Import | Local image preview, CSV/text review and validated basket import |
| Stock Feedback | Stockout/overstock entries, notes, submitted/revised weekly review |
| Saved Drafts | All branch/My drafts, save, resume and delete |
| Order Analytics | Overview/Scorecard/Shadow engine, date windows, volume, supplier/spend/fulfilment summaries and recent submissions |

## Real reference data

The NHS TRUD release dated 2026-11-09 supplies 145,806 active AMPP/VMPP packs, actual identifier strings and available reference prices. Snapshot checksums/counts are tracked in `data/dmd-release.json`. Searches and stock workflows were verified through the hosted API.

## Reconstruction limits

Supplier quotes, availability, stock, Core deliveries, branch transfers, claims credits, support messages and forecasting are isolated simulations. They do not contact suppliers, other branches, the original support service or the original ordering backend. OCR extraction and trained AI are not connected. Support notes stay in the workspace. The demo login does not authenticate against the original site; hosted access remains protected by the private Site gate.

Historical branch data, original forecasting parameters, supplier contracts, production PMR integration and hidden feature-flag rules were not copied. An interface match is not a claim of identical original server behavior. Desktop/mobile reference screenshots and computed styles were inspected; managed visual browser QA of the clone is unavailable in this session.


## Mobile UI refinement

The current interface intentionally improves on the reference screenshot: the oversized manual-search empty illustration is removed, search and ordering actions have priority, source details are disclosed on demand, and workspace-product cards open the same selection modal. Page headings, mobile touch targets, contrast, table overflow and safe-area bottom actions are consistent across the app. Original workflow navigation is retained.
