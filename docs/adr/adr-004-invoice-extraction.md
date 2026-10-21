# ADR-004 — LLM invoice extraction with a strict schema, a validation gate and human review (FatturaPA XML later)

- **Status:** proposed
- **Date:** 2026-10-21 · **Decided by:** founder

## Context
- The PRD sets the volume and goals (Module 1, Goal 5, "Architecture" extraction row):
  - about 25 supplier invoices a month (unverified);
  - the owner reviews and never retypes;
  - under 15 minutes of human review a month;
  - 90% of lines from a mapped supplier need no correction.
- The PRD's intake requirements:
  - PDFs come from the RCH back office and from suppliers;
  - some are scans, some are phone photos;
  - a vision-capable LLM with a strict JSON (Zod) schema;
  - a sum-of-lines gate within €0.05;
  - confidence per field;
  - mapping memory per supplier;
  - Tesseract only as a fallback for scans the model refuses;
  - FatturaPA XML accepted later, skipping the model.
- Verified on 2026-10-21 in the Claude API documentation:
  - Structured outputs are GA through `output_config.format` with a JSON schema.
  - The schema cannot carry numeric or string-length constraints, and the feature is incompatible with citations ([structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)).
  - PDFs are accepted as `document` blocks (base64, URL or Files API) up to a 32 MB request.
  - Each PDF page is processed as both text and image, so scans and text PDFs share one path ([PDF support](https://platform.claude.com/docs/en/build-with-claude/pdf-support)).
- Invoice content is untrusted. Any PDF can carry text meant to manipulate the model (prompt injection).

## Decision
- **Input and model:**
  - Send the PDF as a `document` block, or a photo as an `image` block, to the Claude API.
  - The model ID comes from the environment variable `EXTRACTION_MODEL_ID`. It is never hard-coded.
  - Output is structured through `output_config.format`, with a JSON schema generated from the Zod `InvoiceExtraction` schema.
  - The model has no tools. The prompt states that the document is data and that instructions inside it are ignored. The only extra context is the mapping hints for the same supplier.
- **The output is untrusted input.** In order:
  1. a strict Zod parse (unknown keys, lengths, ranges, dates);
  2. the totals gate (±€0.05; the gross-vs-net interpretation is plan Q20);
  3. deterministic checks that adjust confidence;
  4. the duplicate check (supplier VAT + number + date);
  5. auto-mapping through `supplier_item`.
- **No invoice is ever auto-approved.** `approve_invoice` refuses a total mismatch or a duplicate.
- **Asynchronous processing:** a worker processes one invoice per pg_cron call and retries a bounded number of times.
- **Contract tests:**
  - recorded responses run in CI;
  - 10 anonymised real invoices (plan Q1) run live on demand;
  - a model change requires a green live run.
- **Later inputs:**
  - The Tesseract fallback is built only if the contract set shows refusals (plan variant V5).
  - FatturaPA XML gets a parser feeding the same steps 2–5 (plan M39).

## Alternatives
- **OCR SaaS or a template-based invoice parser.** Pros: deterministic per template. Cons: a subscription and per-supplier templates. Why not: the PRD rejects an OCR subscription, and about 10 suppliers vary in layout.
- **Tesseract-first OCR, then an LLM on the text.** Pros: cheaper tokens. Cons: it loses layout and table structure, and adds an Edge Function and its limits. Why not: the PDF input already gives text and image per page. Tesseract stays a conditional fallback.
- **Free-form JSON prompting without structured outputs.** Pros: works with any model. Cons: malformed output and more retries. Why not: structured outputs are GA, and Zod still validates afterwards.
- **Auto-approval above a confidence threshold.** Pros: less review. Cons: model confidence is self-reported, and prompt injection or a misread total would post stock and payables unchecked. Why not: the PRD says the owner reviews; one tap per invoice meets the time goal.
- **FatturaPA XML only.** Pros: exact data, no model. Cons: needs access to XML from the accountant or the AdE cassetto fiscale, which is not available today (PRD: "if available later"). Why not now: the RCH exports PDF.

## Consequences
- Good:
  - Text and scanned PDFs share one pipeline.
  - Model output can never bypass the validation gate or human approval.
  - The model can be swapped through an env var with a contract run.
  - The XML path reuses the gate and the review.
- Bad / accepted trade-offs:
  - Invoice content goes to an external processor (Anthropic). Data location, retention and the DPA are open (plan Q13).
  - Token costs per invoice are only as stated in the PRD; no new estimate is made.
  - Self-reported confidence is weak, so deterministic checks carry most of the weight.
  - Per-request size limits apply (upload capped below them).
  - Asynchronous processing adds up to a minute of queue wait before extraction starts.
- What would make us revisit this:
  - The contract set shows the 90% target is not reachable.
  - Anthropic data handling is unacceptable to the client.
  - XML becomes available for most suppliers. XML would then become the default and the LLM the fallback.
  - The structured-outputs API changes.
