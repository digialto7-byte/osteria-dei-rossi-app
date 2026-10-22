# Extraction contract tests (live)

These tests call the real model API. They run only from the **Extraction contract** workflow
(Actions > Extraction contract > Run workflow, `workflow_dispatch`), never in `npm test` or CI.
Without the secrets and the invoices below the workflow skips with a `::notice` and succeeds.

## What runs

- `extraction.contract.ts` sends each invoice in `tests/contract/invoices/` to `extractInvoice`
  (no database) and compares the result with its expected file. It fails if an answer does not
  pass the schema or a model call takes 60 s or more (acceptance test 8).
- A synthetic injection PDF (built in memory by `fakeInjectionPdf` in `tests/helpers/fake-files.ts`)
  must come back with its prices as printed, never changed by the text inside it (acceptance
  test 4, live side).
- The summary goes to `$GITHUB_STEP_SUMMARY`: field names, match counts and milliseconds. Invoice
  values are never printed.

## Secrets (GitHub environment `extraction-contract`)

`ANTHROPIC_API_KEY` and `EXTRACTION_MODEL_ID` (the model is the lead's choice). To run by hand:
export both, then `npm run test:contract`.

## The invoices

Ten pairs in `tests/contract/invoices/`:

- `<name>.pdf` (or `.jpg`, `.png`) and `<name>.expected.json`;
- `<name>` uses lower-case letters, digits and `-` only (for example `fornitore-a-01`). Files
  with other names are ignored, and a document without its expected file is not counted;
- never use a real supplier, person or invoice number in a file name.

**Anonymise before committing** (and only if the founder confirms copies may be committed; plan
Q1, otherwise see variant V3):

- replace supplier, customer and bank details (name, VAT number, address, IBAN, phone, email,
  logo) with invented ones, in the document itself and not only on top of it;
- keep amounts, quantities, lot codes and dates that the test needs, and keep the layout;
- remove metadata (PDF author, producer, EXIF data) and any QR code or barcode that identifies
  the venue or a person.

## Expected file

`<name>.expected.json` holds only the fields to check; a field left out is not compared. Names are
those of the extraction schema:

```json
{
  "supplier_name": "Fornitore Demo Srl",
  "invoice_number": "FT 1/2026",
  "invoice_date": "2026-10-15",
  "gross_total": 33,
  "lines": [
    { "description": "Prodotto di prova A", "qty": 2, "unit_price": 5, "lot_code": "L-0425" }
  ]
}
```

Strings are compared after trim and case-fold, amounts to the cent, dates exactly. `lines` are
compared by position, plus the number of lines.

## Summary rows

Besides the per-field accuracy, the summary has one row, **Lines needing no correction**: the
share of expected lines that matched on every field the expected file mentions (a missing line
counts as wrong; invoices that failed the schema are left out). It is the live proxy for the
extraction side of the M4 acceptance test "at least 90% of lines from a mapped supplier need no
correction" (the review screen's "corrected line" is any value the reading got wrong). It only
means something once the samples include two invoices from the same supplier, and it carries
counts and a percentage, never values.
