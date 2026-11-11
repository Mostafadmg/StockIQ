# StockIQ interface and workflow coverage

The client was reconstructed from read-only inspection of the owner's website. All observed primary navigation entries and Advanced/Tools pages are present. The original source and backend rules were not available. This document distinguishes matching interface structure from operational integrations.

| Area | Implemented interface and test behavior |
| --- | --- |
| Shell | Original logo, compact sticky header, violet active pills, clock, branch name, support/truck/alerts/text/theme/basket/account controls; responsive menu and demo sign-in page |
| Auto Orders | Orders/Fast Lines/OTC tabs; compact product table; selections, dismissal, editable shelf counts, add lines |
| Manual Orders | Left medicine lookup and selected packs, right reference-price cards, fixed supplier/total/Continue bar; real dm+d matching; direct quantity/Add to basket controls and a selection modal with Send now and Add to basket plus in-modal result |
| Basket / Order review | Basket opens `/review` with supplier groups, ready lines, quantity and supplier edits, selection, sorting, removal, drafts and a fixed order-total footer; submissions remain simulations |
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

Supplier quotes, availability, stock, Core deliveries, branch transfers, claims credits, support messages and forecasting are isolated simulations. They do not contact suppliers, other branches, the original support service or the original ordering backend. OCR extraction and trained AI are not connected. Support notes stay in the workspace. The demo login does not authenticate against the original site; the owner explicitly made the test Site public; workspaces remain local to each browser.

Historical branch data, original forecasting parameters, supplier contracts, production PMR integration and hidden feature-flag rules were not copied. An interface match is not a claim of identical original server behavior. Desktop/mobile reference screenshots and computed styles were inspected; managed visual browser QA of the clone is unavailable in this session.


## Mobile UI refinement

The current interface intentionally improves on the reference screenshot: the oversized manual-search empty illustration is removed, search and ordering actions have priority, source details are disclosed on demand, and order-list medicine names open the same selection modal. Page headings, mobile touch targets, contrast, table overflow and safe-area bottom actions are consistent across the app. Original workflow navigation is retained.

Medicine results and order-list medicines also offer a separate pack quantity and **Add to basket** button. These shortcuts keep the modal closed, update the basket summary and never submit an order; choosing the medicine name still opens its ordering options.

## Acceptance and delivery flow

The current original deployed client was inspected read-only for its order and schedule contracts. It distinguishes submitted, accepted, partial, rejected and backordered lines; requested, confirmed and received quantities are separate. Supplying wholesaler/depot and scheduled London-time arrivals are visible. The sandbox adopts these distinctions for full, partial and unavailable simulations and never equates an HTTP success with all requested packs being accepted. No original supplier/stock endpoint was invoked. The original authenticated live supplier responses and hidden backend rules were not verified in this update.

Manual Orders now previews supplier availability/cost/arrival and shows accepted and unavailable packs in its result. Basket review shows delivery estimates for each allocation, followed by per-supplier response cards. History, order details and Goods In keep accepted packs still to receive separate from packs not accepted. Goods In groups deliveries by arrival date, with separate late/unknown queues. Standard England/Wales bank holidays, London DST and supplier cutoffs are included in estimates. These remain schedule estimates and cannot represent supplier delivery promises.

## Manual Orders simplification

The owner requested removal of the complete scanner section and Workspace products sidebar. Manual Orders now centres the medicine search, with consistent card padding, a compact catalogue-details row and basket/ordered items below. Name selection, Send now, direct Add to basket, supplier comparison and the basket review route remain available. There are no scanner controls, keyboard scan input or serial device connections.

## Original visual theme

The original public frontend styles and supplier map were read again on11November2026. Exact token values, asset paths and SHA256 hashes are recorded in `visual-reference.json`. The final `reference-theme.css` and `reference-pages.css` layers restore the original palette, supplier tags, font, compact controls and page-specific states over the earlier visual polish. Current source-defined Phoenix orange is#ea580c; the older captured#f97316 is superseded. The modal, Send now, direct Add to basket, test quotes and aligned date grouping are retained. Labels and values continue to describe the real reference versus simulated workspace data; the styling does not turn test values into live supplier data.

No fresh authenticated browser or visual comparison was available: the shared desktop capability is enabled but reports state unknown, and the desktop JavaScript control tool is absent for the selected cloud environment. Current deployed CSS/JS contracts and prior reference captures provide evidence for the styling; they do not establish pixel-perfect visual equivalence on every route or viewport. The removed oversized magnifier is intentionally not reintroduced.

The order-items list now refreshes immediately after basket additions or direct submissions. Saved acceptance/receipt facts remain distinct from basket quantities, and imported packs used only for quote previews are omitted. Dropdown quantity controls retain focus and their values when editing or returning to the medicine query. Normal rows use a medium density between the original compact reference and the first spacious redesign.

Ordered, Rejected / unobtainable and Basket are now toggles in the Manual Orders panel. Ordered is the initial view, and line counters update without remounting the search. Partial acceptance contributes the supplied quantity to Ordered and the unsupplied quantity to Rejected, with no arrival or charge implied for unsupplied packs. Basket quantity/supplier editing, removal and test submission are available on the same page.
