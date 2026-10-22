# Contract test invoices

The invoices here are **anonymised, generated copies** of samples supplied by the founder
(first sample 2026-10-22). The founder approved committing anonymised copies (plan Q1). They are
not the original documents: each PDF is rebuilt from scratch, and every identifying detail
(supplier, buyer, addresses, VAT numbers and tax codes, client code, invoice number, bank, IBAN,
software footer, PDF metadata) is invented. The VAT numbers have a valid checksum but belong to
no one; the IBAN starts with `IT00` and is not a real account.

The line data (descriptions as printed, units, quantities, prices, amounts, VAT codes, delivery
notes and their dates, page split) is kept as in the original, so the test stays realistic.
The originals are never committed.

## Samples

### `fornitore-ortofrutta-01`

A fruit and vegetable supplier's deferred invoice ("fattura differita"), 4 pages. It exercises:

- a deferred invoice that groups many deliveries;
- delivery-note header rows ("Rif. Documento di trasporto n. … del …") between the items, which
  must not become lines, including a header that ends a page with its items on the next one;
- no supplier codes (the Codice column is empty);
- a typo in a description (`POMDOORO PICCADILLY`), which must be kept as printed;
- the same article at different unit prices across deliveries;
- the VAT summary and totals block repeated on every page, which must be read once;
- a free-text note in the description column on the last page, which is not a line;
- 82 lines (18 distinct articles), units `KG` and `NR`, VAT code `04` (4%).

The expected file compares supplier, VAT number as printed (without `IT`), invoice number and
dates, the three totals and all 82 lines (description, qty, unit, unit price, amount, VAT rate).
