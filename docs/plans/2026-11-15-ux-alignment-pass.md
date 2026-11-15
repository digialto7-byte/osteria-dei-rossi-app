# Tech plan — Osteria Dei Rossi app · UX alignment pass

- **Client slug / internal:** `osteria-dei-rossi` (no client facts used; design rulings only)
- **Repo and branch:** `osteria-dei-rossi-app`, `feat/ux-alignment` (from `origin/main`)
- **Author:** architect · **Date:** 2026-11-15
- **Source rulings:** `docs/ux/costi-design-system.md` §10.4 (emphasis and slots) and §10.5 (print), designer and lead, 2026-11-15.

## 1. Goal and scope

- **Goal:** bring the code in line with three fixed design rulings: rename LedgerRow's end slot, set six key figures in `<strong>`, and print in black on white.
- **In scope:**
  1. Rename `LedgerRow`'s `badge` prop to `trailing`, with no alias. Its DOM hook `data-ledger-badge` becomes `data-ledger-trailing` in the same rename.
  2. Put six figures in `<strong>`: on-hand, count net, waste total, the Home payables amount, the Chiusura app total and the Chiusura per-service totals.
  3. Replace the colour-free `@media print` block with the Costì print palette, and update the e2e pin.
- **Out of scope:** any other look change; `supabase/`, `src/server/`, `src/app/api/`, `public/sw.js`, `src/proxy.ts`, `next.config.ts`, `.github/` and package files; docs (see Q-3); Figma ("Show badge" becomes "Show trailing" later, designer's action).

## 2. Current state

**LedgerRow** is in `src/components/ui.tsx:263-322`. The `badge` prop is declared in the `LedgerRowProps` union (`:272`, `:273`), destructured at `:285` and rendered at `:302-306` inside `<span data-ledger-badge="">`. The doc comment at `:265-269` still says "badge". Grepping `src/`, `tests/` and `e2e/` turns up these users of the prop or its hook:

| Kind | File:line | Use |
|---|---|---|
| Caller (the only one) | `src/components/dashboard/payables-tile.tsx:46` | `badge={<span className="num font-bold">{formatEur(item.amountEur)}</span>}` |
| Unit test | `tests/components/ledger-row.test.ts:12, 13, 18, 29, 34, 50` | describe/it titles, `badge:` props, `[data-ledger-badge]` |
| Unit test | `tests/components/dashboard-tiles.test.ts:247` | `data-ledger-badge=""` (trailing-slot order check) |
| e2e | none | (`data-badge="lot-missing"` in `e2e/trace.spec.ts:217` and `e2e/xml-invoice.spec.ts:43` is the review-line Badge, not LedgerRow) |

The other 60-odd `LedgerRow` uses are free-form (`children`) and do not change. `badge=` at `src/app/(owner)/page.tsx:136` is a prop of `HomeAlertsView`, not of `LedgerRow`, and the `badge:` keys in `src/lib/invoices/upload-result.ts` and `home-alerts.tsx` are unrelated too.

**The six figures** today:

| # | Figure | File:line | Today | Tests that assert it |
|---|---|---|---|---|
| F1 | Ingredient on-hand (magazzino detail) | `src/app/(owner)/magazzino/[ingredientId]/page.tsx:182-184` | `<FactRow testId="fact-on-hand"><span className="font-bold">…` | `tests/components/ingredient-facts.test.ts:64-65` (`.font-bold` inside `fact-on-hand`); e2e `stock.spec.ts:118,131,142,155,168`, `batches.spec.ts:185` (`toHaveText` only) |
| F2 | Count net (variance totals) | `src/app/(owner)/magazzino/conteggi/[id]/scostamenti/variance-row.tsx:49-51` | `<FactRow label=variance.totals.net><span className="font-bold">…` | `tests/components/variance-row.test.ts:104-113` (`:112` regex `<span class="font-bold">…€</span>`) |
| F3 | Waste total | `src/app/(owner)/magazzino/sprechi/waste-costs.tsx:39-41` | `<FactRow testId="fact-waste-total"><span className="font-bold">…` | `tests/components/waste-costs.test.ts:59` (regex `<span class="font-bold">15,00 €</span>`), `:70`; e2e `batch-actions.spec.ts:264`, `stock.spec.ts:194` (`toHaveText` only) |
| F4 | Home payables amount (row amount in the payables tile) | `src/components/dashboard/payables-tile.tsx:46` | `<span className="num font-bold">` in the trailing slot | `tests/components/dashboard-tiles.test.ts:221-228`, `:230-255` (`:253` regex `<span class="num font-bold">…€</span>`) |
| F5 | Chiusura app total | `src/app/(owner)/chiusura/page.tsx:159-165` | `<p className="text-xl font-bold tabular-nums">Totale app … · … · …</p>` | `tests/components/day-close-page.test.ts:67, 94, 182` (leaf-element exact text), `tests/components/day-close-services.test.ts:204`; e2e `day-close.spec.ts:54`, `simulation/service.spec.ts:411, 457` (text only) |
| F6 | Chiusura per-service totals | `src/app/(owner)/chiusura/services-card.tsx:45-49`; string from `dayServiceRow` (`src/lib/services/services-view.ts:47-63`, message `dayClose.services.row` = `{name} · {tables} · {covers} · {amount}`) | plain text in `<li data-service-key>` | `tests/components/day-close-services.test.ts:78-81` (row `textContent`), `tests/lib/services/services-view.test.ts:72-89` |

No e2e asserts a font weight (a grep for `font-weight` in `e2e/` finds nothing), and no e2e takes a screenshot. The house precedent is a plain `<strong>` with no class (`report/services-panel.tsx:20-32`, `fatture/[id]/revisione/xml-summary.tsx:111`).

**Print** is in `src/app/globals.css:303-325`, in one `@media print` block. That block holds only A4, `color-scheme: light` and the hidden slots. Its comment says "No colour is defined here", and `tests/components/print-css.test.ts:66-69` enforces that. On paper, a page therefore takes whichever light palette is active: osteria `@theme` at `:20-45`, or Costì `:root:has([data-brand="costi"])` at `:111-136`. Both dark blocks (`:76`, `:147`) are `screen and (prefers-color-scheme: dark)`. The header band is `.band` (`globals.css:218-234`, a grain `background-image`), and `HeaderBand` sets `--color-band` / `--color-band-ink` **inline** for the venue layer (`src/components/header-band.tsx:25-28`). Charts fill bars with `accent` / `danger` on a `sunk` track (`globals.css:387-405`, `src/components/charts/*`; used on `/report` `kpi-panel.tsx` and dashboard tiles).

**Print assertions in `tests/` and `e2e/`:**
- `e2e/exports.spec.ts:217-257`, test "on paper … light ink …". The pin at `:247-249` expects body `rgb(31, 41, 51)` on `rgb(247, 248, 246)`. The header comment `:24` reads "light ink on paper".
- `tests/components/print-css.test.ts:36-70` checks: one block, A4/12 mm, hidden slots, `color-scheme: light`, **no colour** (`:66-69`). `:72-85` checks that both dark palettes are screen-only.
- `tests/components/monthly-pack.test.ts:237-265` checks the `data-print="hide"` placement only. It is unaffected.
- Every other `emulateMedia` call in `e2e/` sets `colorScheme` only, never `media: "print"`.

## 3. Design

### 3.1 LedgerRow `trailing`
- In `LedgerRowProps`, `badge?: ReactNode` becomes `trailing?: ReactNode` in both union arms (`trailing?: never` in the free-form arm). The destructured name and the render condition change with it. `<span data-ledger-badge="">` becomes `<span data-ledger-trailing="">`, and the doc comment says "trailing slot (an amount or a badge)". There is no alias: strict TypeScript then flags any missed caller at `npx tsc --noEmit`.

### 3.2 `<strong>` for the six figures
- **Rule.** The figure goes in a plain `<strong>`, and the `font-bold` that used to style it is removed. Tailwind v4 preflight sets `strong { font-weight: bolder }`, and all six parents are weight 400, so the computed weight stays 700 and the look is unchanged. If a parent kept `font-bold`, `bolder` would compute to 900. Inter 900 is not loaded, so that would be a hidden drift. Other classes stay: `num` remains on F4's element (`<strong className="num">`).
- **F1–F3:** `<span className="font-bold">X</span>` becomes `<strong>X</strong>` inside the existing `FactRow` (`dd.num`).
- **F4:** `trailing={<strong className="num">{formatEur(item.amountEur)}</strong>}`. The overdue/due-soon sentences above the list (`payables-tile.tsx:25-37`) are not touched (Q-2 covers the scope question).
- **F5:** `<p className="text-xl tabular-nums"><strong>{t("dayClose.app.total", …)}</strong></p>`. The whole line goes in `<strong>` because the line is already set bold today, so the look stays the same. The `<strong>` is then the leaf element that the exact-text helper in `day-close-page.test.ts:56-59` finds.
- **F6:** only the amount goes in `<strong>`. The service name, tables and covers are labels and stay regular. A new pure function in `src/lib/services/services-view.ts`:
  ```ts
  export function dayServiceRowParts(service: DayServiceRowInput): { lead: string; amount: string; tail: string }
  ```
  It formats `dayClose.services.row` with a private-use sentinel in place of `{amount}` and splits on the sentinel, so the amount's position comes from the message in any locale. The open-tables suffix goes in `tail`. `dayServiceRow` becomes `lead + amount + tail`, so its existing tests still hold. The card renders `{lead}<strong>{amount}</strong>{tail}`, and the row's `textContent` stays the same. No i18n string changes.

### 3.3 Print palette (one global block)
- **Values live in code twice, kept equal by a test**, like the screen tokens. Add `PRINT_COLORS: Record<ColorToken, string>` (all 25 tokens) to `src/lib/design/tokens.ts`. Inside the existing single `@media print` block in `globals.css`, add `:root, :root:has([data-brand="costi"]) { --color-…: #RRGGBB; … }`. That selector has the same specificity as the Costì block and comes later, so it wins over the osteria and Costì light palettes alike.
- **Values** (default for the fills not named by the ruling: Q-1, variant V1):

| Tokens | Print | Basis |
|---|---|---|
| `ink` | `#000000` | ruling |
| `ink-muted` | `#404040` | ruling |
| `paper`, `surface`, `sunk` | `#FFFFFF` | ruling |
| `rule`, `rule-strong` | `#000000` | ruling (widths unchanged) |
| `gold` (Coral marks), `success`, `warning`, `danger`, `info`, `accent-ink`, `focus` | `#000000` | ruling ("Coral and the other tones") |
| `band` / `band-ink` | `#FFFFFF` / `#000000` | ruling (no band background) |
| fills `highlight`, `accent`, `accent-hover`, `success-bg`, `warning-bg`, `danger-bg`, `info-bg` | `#FFFFFF` | Q-1 default |
| words on fills `on-highlight`, `on-accent` | `#000000` | Q-1 default |

- **Q-1 default and the reason for it.** Browsers leave out CSS backgrounds when printing unless the user turns them on ([MDN `print-color-adjust`](https://developer.mozilla.org/en-US/docs/Web/CSS/print-color-adjust)). With white fills and black words, every word prints in both cases. A black Coral or Forest fill with white text would lose the word ("Consigliato", a primary button) on a default print. The Badge dot uses `bg-on-highlight`, so a highlight badge still prints a black dot.
- **Band.** Add `.band { --color-band: var(--color-paper) !important; --color-band-ink: var(--color-ink) !important; background-image: none; }`. The `!important` beats the venue layer's inline custom properties. The 2 px `border-gold` rule under the band prints black.
- **Shadows.** Add `*, *::before, *::after { box-shadow: none !important; text-shadow: none !important; }`.
- **Charts.** With `accent` printing white, bars would vanish, so add `[data-chart-value] { fill: var(--color-ink); }`. This mirrors the forced-colors block, and the BarTable numbers still carry the meaning.
- **Comment.** The block comment changes from "No colour is defined here" to "Costì print palette (costi-design-system §10.5), mirrored in `PRINT_COLORS`".

### 3.4 Data model / API
None. There are no migrations, routes or server changes.

## 4. Alternatives considered

- **A compatibility alias (`badge` as a deprecated synonym).** Rejected by the ruling: there is no production data and only one caller, and strict TypeScript catches every miss.
- **Keeping `data-ledger-badge` while renaming only the prop.** Rejected: a slot named "trailing" in code and "badge" in the DOM is the drift this pass removes. Only two unit tests read the attribute.
- **F6: `<strong>` around the whole service row.** Rejected: it would make the service name and counts bold too, a larger visible change than the ruling asks for, and §10.4 reserves bold for the figure.
- **F6: `indexOf(amount)` on the finished string.** Rejected: it breaks if a service name contains the same amount text. The sentinel split does not depend on the content.
- **Print colours via `var()` to existing tokens only (no hex in the block).** Not possible: `#000`, `#404040` and `#FFF` are not screen token values. Mirroring them in `PRINT_COLORS` keeps the house rule that every colour is in `tokens.ts` with a drift test.
- **A second print block (for example per page).** Rejected: the ruling and ADR-027 want one global block, and `print-css.test.ts` "exists exactly once" stays.

## 5. Build plan

Each step is one commit. Write the test change first and run it to see it fail (red), then make the code change (green). After each step, run `npx tsc --noEmit`, `npm run lint` and `npm test`. Step 7 also runs e2e.

| # | Step (one commit) | Files | Test that proves it (written first, red before the change) |
|---|---|---|---|
| 1 | LedgerRow: `badge` → `trailing`, `data-ledger-badge` → `data-ledger-trailing`, doc comment | `src/components/ui.tsx`, `src/components/dashboard/payables-tile.tsx` (prop name only), `tests/components/ledger-row.test.ts`, `tests/components/dashboard-tiles.test.ts:247` | `ledger-row.test.ts`: every `badge:` becomes `trailing:`, `[data-ledger-badge]` becomes `[data-ledger-trailing]`, the titles say "trailing", plus a new `@ts-expect-error` case: `{ title: "T", badge: "x" }` is no longer a valid `LedgerRowProps`. `dashboard-tiles.test.ts:247` looks for `data-ledger-trailing=""`. Before the change these fail (wrong attribute, unused `@ts-expect-error`). `tsc` proves there is no other caller. |
| 2 | F4 payables amount → `<strong className="num">` | `src/components/dashboard/payables-tile.tsx:46`, `tests/components/dashboard-tiles.test.ts:253` | `:253` regex becomes `/<strong class="num">[^<]*\d[^<]*€<\/strong>/`, and the trailing slice must contain no `font-bold`. `:221-228` stays as it is (text). |
| 3 | F1, F2, F3 (the P2f figures) → `<strong>` | `magazzino/[ingredientId]/page.tsx:183`, `scostamenti/variance-row.tsx:50`, `sprechi/waste-costs.tsx:40`; `tests/components/ingredient-facts.test.ts:65`, `variance-row.test.ts:112`, `waste-costs.test.ts:59` | `ingredient-facts`: `fact-on-hand` has a `strong` child with text `12,3 kg` and no `.font-bold`. `variance-row:112`: `/<dd[^>]*><strong>[^<]*€[^<]*<\/strong><\/dd>/`, test title "the net in <strong>". `waste-costs:59`: `<strong>15,00 €</strong>` inside the `dd`. The e2e `toHaveText` pins (§2) stay green with no change. |
| 4 | F5 Chiusura app total → `<p className="text-xl tabular-nums"><strong>…</strong></p>` | `src/app/(owner)/chiusura/page.tsx:159-165`, `tests/components/day-close-page.test.ts` | New assertion in the "shows the app's total…" test (`:92-99`): `byText(nb("Totale app 1.234,50 € · 3 tavoli · 6 coperti")).tagName === "STRONG"` and its parent `p` has no `font-bold`. Existing `:67, :94, :182` stay green. |
| 5 | F6 per-service totals: `dayServiceRowParts` + `<strong>` on the amount | `src/lib/services/services-view.ts`, `src/app/(owner)/chiusura/services-card.tsx:45-49`, `tests/lib/services/services-view.test.ts`, `tests/components/day-close-services.test.ts` | `services-view.test.ts`: new `describe("dayServiceRowParts")`. It checks that `lead + amount + tail` equals `dayServiceRow(...)` for the 0, 1 and 3 open-table cases, that `amount` is `nb("18,00 €")`, and that `tail` holds the open-tables words. It also covers a service named `"18,00 €"`, where the split still finds the real amount, and the `en` locale. `day-close-services.test.ts`: every `[data-service-key]` has exactly one `strong` whose text is the row's amount, and `:78-81` `textContent` stays unchanged. |
| 6 | `PRINT_COLORS` in tokens + print palette, band, shadows and chart rule in the one print block | `src/lib/design/tokens.ts`, `src/app/globals.css:303-325`, `tests/components/print-css.test.ts` | `print-css.test.ts`: the guard "defines no colour of its own" (`:66-69`) is **replaced** by these checks. (a) The block has one `:root, :root:has([data-brand="costi"])` rule whose `--color-*: #RRGGBB;` declarations equal `PRINT_COLORS` for all 25 `COLOR_TOKENS`. (b) `PRINT_COLORS` holds the §3.3 values: `ink` `#000000`, `ink-muted` `#404040`, `paper`/`surface`/`sunk` `#FFFFFF`, `rule`/`rule-strong` `#000000`, `gold` and the four tones `#000000`. (c) `contrastRatio(ink-muted, paper) ≥ 9`, and every pair in `CONTRAST_PAIRS` reaches its minimum with `PRINT_COLORS`, except the pairs whose foreground is a fill that the Q-1 default whitens (`accent`, `accent-hover`, `highlight`; today that is the two "primary button shape" pairs at `tokens.ts:273-274`). The test names those exceptions explicitly. (d) A `.band` rule sets `background-image: none` and `--color-band` with `!important`. (e) A universal rule sets `box-shadow: none !important`. (f) `[data-chart-value]` gets `fill: var(--color-ink)`. The existing A4, hidden-slot, one-block, `color-scheme` and screen-only-dark tests stay. |
| 7 | e2e pin: black on white | `e2e/exports.spec.ts:24, 217, 239, 247-249` | The test title and comments change from "light ink" to "black ink on white". Pin: body `color` `rgb(0, 0, 0)`, `background-color` `rgb(255, 255, 255)`. Added: the header band (`.band`) has `background-image` `none`, and a `.rounded-card` has `box-shadow` `none`. This is red on `main`, and green once step 6 is in. Run `npx playwright test e2e/exports.spec.ts`, then the full suite. |

Write step 7's failing pin before step 6's CSS, but keep them as separate commits so the e2e change can be reviewed on its own.

### 5b. Variants

**V1: fills print as the ruling's literal #000** · Trigger: Q-1 answered "Coral and accent fills print black" · Replaces step 6 values for `highlight`, `accent`, `accent-hover` (→ `#000000`) and `on-highlight`, `on-accent` (→ `#FFFFFF`).

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V1.1 | V1 values in `PRINT_COLORS` and the print block, plus `print-color-adjust: exact` on `[data-tone="highlight"]` and the primary button and link classes, so the white word keeps its black fill | `src/lib/design/tokens.ts`, `src/app/globals.css` | `print-css.test.ts`: (b) expects the V1 values; a new check finds `print-color-adjust: exact` (and `-webkit-print-color-adjust`) on those selectors inside the print block; (c) the contrast loop runs with **no** exceptions (`accent` on `paper`/`surface` is black on white). |

**V2: the stock list's on-hand total too** · Trigger: Q-2 answered "yes, the list row as well" · Replaces: none (added after step 3).

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V2.1 | `stock-row.tsx:29` `<span className="num shrink-0 font-bold">` → `<strong className="num shrink-0">` | `src/app/(owner)/magazzino/stock-row.tsx`, `tests/components/stock-row.test.ts:18` | `:18` regex becomes `/<strong class="num[^"]*"[^>]*>12,3 kg<\/strong>/` with no `font-bold`. |

## Lists touched (guard and list tests in `tests/` and `e2e/`)

| Test | Effect |
|---|---|
| `tests/components/print-css.test.ts` | **Guard replaced** (step 6): "defines no colour of its own" becomes "declares exactly `PRINT_COLORS`". This is not a weakening: the replacement checks every value. The one-block, A4, hidden-slot list (`PRINT_HIDDEN`), `color-scheme: light` and screen-only-dark checks are unchanged. |
| `e2e/exports.spec.ts` T1 (`:217-257`) | Pin changed to black on white (step 7). |
| `tests/components/ledger-row.test.ts` | Component contract renamed (step 1). |
| `tests/components/dashboard-tiles.test.ts:230-255` | Slot attribute and amount element (steps 1–2). |
| `tests/lib/design/tokens.test.ts` | Unchanged and must stay green. Its `globals.css` slices end at `@layer base` (`:190-240`), and the print block sits after it, so the new `--color-*` lines are outside every slice. The accent-only-as-text guard (`:151-176`) is unaffected because the print block has no `color: var(--color-gold)`. |
| `tests/components/costi-theme.test.ts:93-100` | List of files that may name `data-brand`. `app/globals.css` is already on it, and the new print selector stays inside that file. Unchanged. |
| `tests/lib/design/sala-contrast.test.ts:14`, `tests/design/kitchen-contrast.test.ts:30` | Read specific `[data-contrast="high"]` rules. The print `box-shadow: none` is a separate rule inside `@media print`. Unchanged, check it stays green. |
| `tests/components/costi-theme-order.test.ts` (route-group list) | Not affected: no route group changes look. |
| `tests/components/monthly-pack.test.ts:237-265` (`data-print="hide"` placement) | Not affected. |

## 6. Risks and mitigations

- **Hidden weight drift.** If a parent keeps `font-bold`, `strong` computes to 900. The plan removes `font-bold` from each of the six. Steps 2–4 assert that it is gone from the figure (and, for F5, from its `p`). F6's `li` never had it.
- **Print overrides lose to inline or more specific rules.** The venue band's inline variables are covered by `!important` in step 6 and asserted in step 7. The Costì root has the same specificity and comes later in the source. A future third palette selector would need adding to the print rule; step 6 (a) fails if the print rule's selector list changes.
- **Things that relied on a shadow or a fill go blank on paper.** Inset-ring borders (for example the kitchen high-contrast badge ring) are not printed screens. Chart bars are covered by the `[data-chart-value]` rule, and chart tracks go white on white, but the BarTable figures carry the meaning (ADR-021). Under the Q-1 default, primary buttons print as bold black words with no fill or shape (the "primary button shape" pairs are named exceptions in step 6 (c)). Pages hide most controls with `data-print="hide"`.
- **Browser variance.** The pin is Chromium only, as ADR-027 already notes. Background omission differs by browser, and the Q-1 default is chosen so that it does not matter.
- **Docs drift.** ADR-027 decision 5 says the pack "prints in the light palette", and `docs/` is outside this pass's allowed paths (Q-3).
- **Security / privacy:** no auth, data, route, secret or personal-data change. This is CSS, markup and one pure string helper. Existing `textContent` and RLS-backed payloads are unchanged. No secrets are involved, so none are stored anywhere new.
- **Dependencies:** none added.

## 7. Open questions for the founder

- **Q-1 (print fills).** The ruling says Coral and the tones print `#000`, and pages and surfaces `#FFF`. For **fills that carry a word** (`highlight` badge, `accent` primary button, the status `-bg` tints), may they print **white with black words** (default, step 6) so nothing is lost when the browser omits backgrounds? The alternative is a literal black fill with white words, which needs forced background printing (V1). Coral marks (`gold`) and tone text print black either way.
- **Q-2 (scope of "ingredient on-hand").** The plan covers the detail page's on-hand fact (`fact-on-hand`, the P2f figure). Should the stock list row's total (`magazzino/stock-row.tsx:29`) also move to `<strong>` (V2)? Default: no. Likewise the payables tile's overdue / due-soon sentences stay as they are by default.
- **Q-3 (docs).** Who amends ADR-027 decision 5 ("light palette" → "Costì print palette, black on white") and `ui-foundation.md` once this merges? Default: the lead, in a docs-only follow-up, because `docs/` is outside this pass.
