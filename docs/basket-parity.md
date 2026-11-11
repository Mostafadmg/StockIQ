# Basket and order review

The original application's publicly delivered ordering modules were inspected on
11 November 2026. No account login or live order submission was performed during
this inspection.

## Verified original behavior

- The shared header's Basket button navigates to `review-order`, whose route is
  `/review`. It does not open a basket modal.
- The page is titled **Order review**. Its main content is bounded at 1,360px,
  with a fixed order-total and submission footer.
- The ready section reads **Ready to order** / **Sent when you submit**.
  Supplier sorting groups lines with supplier names, line counts and subtotals.
- The toolbar exposes **Refresh stock**, draft status and Wholesaler, Total,
  A–Z and Item price sorting. A–Z ascending is the default; numeric sorts start
  descending. Lines can be selected individually or together.
- Desktop columns are selection, Product, Stock, Target, Price, Supplier,
  Order, Total and removal. Stock and Target are read-only; order quantity is
  editable. Below 768px, lines use a compact stacked layout.
- The footer contains Order total, the count of lines to send, delivery
  information, Save draft and Submit to wholesalers actions.
- Supplier selection exposes alternative offers, with explicit confirmation;
  the mobile comparison appears as a bottom sheet. Save draft prompts for a
  name and supports cancellation without changing the basket.

## Sandbox implementation

Basket entry points use `/review`. Quantities, removal, supplier allocation,
sorting, selection and draft restoration stay on the review page. Refreshing
recalculates test quotes; it does not contact a supplier. Submission accepts
only explicitly checked valid lines and retains unchecked basket lines. Items
start selected, with Select all / Clear selection and individual checkboxes in
both the Manual Orders Basket tab and full review. Selection stays shared
while navigating the app; clearing it disables submission instead of falling
back to all lines. New basket entries start selected.

Supplier triggers now open the same compact supplier-price and delivery modal
as Manual Orders. The basket mode keeps the current medicine identity fixed,
shows its saved supplier initially and changes only quantity and supplier via
one explicit Save basket changes PATCH. Opening, comparing and cancelling do
not import products, add packs or submit orders. A failed save keeps the edits
open for retry.

NHS pack identities remain real reference records. Supplier prices, availability,
delivery estimates and submissions remain simulations. The review only presents
states supported by the test workspace; it does not invent live warnings,
pending supplier replies, product switches or production order results.

## Source evidence

| Original public asset | SHA-256 |
| --- | --- |
| `OrderingModule-BdOQxfdo.js` | `e0bc32b51eb88993e1ea2f52a71f0ec4ae5cb7c60b25718fab7c915151ad9c29` |
| `OrderReviewPage-EyEQlrqu.js` | `823e57850d571b852508e65c888daf66096dab567d73fd60c08a903cf3034bf7` |
| `BasketSwitchLine-DWZHWCLF.js` | `bdbb187bc811a7efc0a5335d347401c73c7b6558fb2c80458eb83f306e4c32a3` |

The source verifies routing, labels, rendering rules and interaction contracts.
Account-specific data and visual equivalence were not verified in a signed-in
browser: this chat's shared cloud-browser control tool was unavailable. No live
basket, stock, draft or order was changed.
