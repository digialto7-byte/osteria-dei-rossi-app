# Extraction timing: do the limits hold on real invoices? (P2-0 F26)

The extraction call has a token ceiling (`EXTRACTION_MAX_TOKENS`), a request timeout (`EXTRACTION_TIMEOUT_MS`) and a line cap
(`MAX_EXTRACTED_LINES`), all in `src/server/extraction/constants.ts`. The estimates behind them are not measured. This document holds the
method, the empty table for the runs, and the decision rule, fixed **before** any number exists. It is checked by
`tests/config/extraction-timing-doc.test.ts`.

**State today: nothing is measured.** Every cell is `pending (founder)`, written `pending` in the table, and the decision is pending. No code
changes: `src/server/extraction/extract.ts` already logs `outputTokens` and `durationMs`, with no row data.

**Which invoices.** The runs use whatever supplier invoices the founder uploads in normal UAT on staging, in the founder's tenant (the lead's
decision Q-P0-2, 2026-11-11). There is no special run, and no new data class goes to the extraction provider. DPA-1 (the data-processing terms
with the extraction provider) stays open. On the provider account (M3 Q4/Q5): per the lead, 2026-11-11, it is the same
owner's account. The repository holds no record of an earlier decision on this (`docs/plans/2026-10-22-m03-extraction.md` lists both
questions as open and `docs/go-live/phase1-closeout.md` still lists M3 Q5 as remaining), so this is an attribution to the lead, not a
citation of a repository document.

## Method

1. After the founder has uploaded invoices on staging in normal UAT and the extraction has run, open Vercel, the staging project, Logs. Read the
   logs the same day: how long Vercel keeps them depends on the plan and is read on the dashboard, not assumed here.
2. Filter on the function `/api/cron/extract` and the text `"event":"extraction"`. Each extraction call writes one such line.
3. For each line copy **only** these fields: `outcome`, `outputTokens`, `durationMs` and `effort`. Add `lines`: the number of lines the review
   screen shows for that invoice (a count, nothing else).
4. Never copy `requestId` or `errorMessage`, and never copy `flags`, a supplier name, a description, an amount or anything else from an invoice.
5. A call that ended in a thrown error (for example a timeout) logs no `outputTokens`: write `pending` in that cell.

## Runs

Fill a row per log line, `run` counting 1, 2, 3 and so on. `outcome` is `ok`, `pending`, or one of the failure codes in
`src/server/extraction/outcome.ts`. `lines`, `outputTokens` and `durationMs` are integers or `pending`.

| run | outcome | lines | outputTokens | durationMs | effort |
|---|---|---|---|---|---|
| 1 | pending | pending | pending | pending | pending |

## Decision

**The rule, fixed before any number (Q-P0-3, accepted 2026-11-11).** A change to the limits is needed when any of these holds:

- any run's `outcome` is `provider_timeout` or `output_truncated`;
- over the `ok` runs, `max(outputTokens / lines) x MAX_EXTRACTED_LINES` is at or over `EXTRACTION_MAX_TOKENS`;
- over the `ok` runs, `max(durationMs / lines) x MAX_EXTRACTED_LINES` is at or over `EXTRACTION_TIMEOUT_MS`.

The constants are read from `src/server/extraction/constants.ts`; no value of theirs is written here, so this text cannot drift from them. The
linear projection per line is a screening rule, not a model of the provider's behaviour. It is conservative on short invoices, because a fixed
part of every call's time is counted against few lines; read such a run with that in mind before choosing `change:`.

`Decision: no change` is refused while the rule holds, while there is no `ok` run, and while an `ok` run lacks a number. `Decision: pending`
is refused once no cell is pending. A `change:` needs a reason after the colon, and a change starts a new plan; none is designed here.

Decision: pending
