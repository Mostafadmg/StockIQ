# Medicine barcode reference

The StockIQ scanner follows the keyboard-scanner approach used by
`Mostafadmg/mellonsdaily`, inspected at commit
`76ddd733c25374e53afd28bb0baa0f2c3f63d5e2` on 11 November 2026.

## Mellonsdaily behavior

- `src/components/BarcodeScanForm.tsx` accepts keyboard-wedge scans, completes a
  scan with Enter or unmodified Tab, and preserves ASCII 29 when a scanner sends
  it as Ctrl+] or `GroupSeparator`.
- `src/lib/gs1.ts` validates the GTIN check digit and zero-pads EAN/UPC values to
  GTIN-14. GS1 application identifiers 01, 17, 10 and 21 provide product, expiry,
  batch and serial. A day of 00 means the end of the encoded month.
- `src/lib/dmdGtins.ts` joins the NHS `f_gtin2_*.xml` AMPP/GTIN associations to
  dm+d AMPP names. `src/lib/dmdSync.ts` obtains that XML from the TRUD dm+d
  distribution. Reference data and staff-taught names are separate tables.

StockIQ uses the exact NHS reference associations; it does not import
Mellonsdaily's staff-entered product names, shelf locations or clinical records.
It also does not guess the split between batch and serial when a scanner drops
GS1 separators. Scanning identifies a pack for review and never places an order.

## NHS source and pinned assets

NHSBSA confirms that the weekly dm+d distribution includes an AMPP-to-GTIN XML
mapping file: [Release of dm+d files](https://www.nhsbsa.nhs.uk/cy/node/14056).
The distribution and licence are supplied through
[NHS TRUD](https://isd.digital.nhs.uk/).

The existing StockIQ assets are pinned to the **9 November 2026** dm+d release,
with the GTIN extract dated **5 November 2026**:

| Asset | Provenance |
| --- | --- |
| `data/dmd-gtin.json` | Deterministic compressed GTIN index, SHA-256 `1629b72bf25a85cb62ac5ed91069db8ad1036603f21a8b225c1766a588751f6d` |
| `data/dmd-gtin-release.json` | Records source filename `f_gtin2_0051126.xml` and source SHA-256 `7da0ca7cd4209d164d568758ee3334d7cc6d1e4f6a9af392b8820b62cfeab8c2` |
| `data/dmd-catalogue.json` | Matching active-pack catalogue, SHA-256 `2cad688f423fc9eebb921b1a6c60c25731f04de61cf1f1eaefe461cbdf56f8f9` |
| `scripts/prepare-gtin.py` | Offline extractor checks the pinned XML and catalogue checksums before generating the index |

## Mapping policy and verification

Only associations to active catalogue AMPP IDs are indexed. Current
associations take precedence over ended ones; ended associations remain
available only when there is no current association for that GTIN. Historical
and ambiguous matches require an explicit pack choice in the UI.

A full decode of the checked-in index at source commit `a103cbef` verified:

- **72,882** valid GTIN-14 codes, each in its declared prefix shard.
- **63,228** current GTINs with 63,228 associations.
- **9,654** historical GTINs with 9,684 associations, including **30** ambiguous
  codes whose candidate packs are all preserved.
- Every mapped ID exists as an AMPP in the matching active dm+d catalogue; no
  duplicate pack association, future start date or historical-date mismatch was
  found.
- Dataset and catalogue hashes match the recorded metadata; decoded counts and
  release dates match both assets and release metadata.

This check verifies the bundled assets and their recorded provenance. The
original NHS XML is not bundled and was not re-downloaded during this audit.
Supplier availability and comparison prices remain test data, separate from
the medicine identity and NHS reference prices.
