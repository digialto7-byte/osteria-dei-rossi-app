# Tech plan — Osteria Dei Rossi app · UX alignment pass

- **Client slug / internal:** `osteria-dei-rossi` (no client facts used; design rulings only)
- **Repo and branch:** `osteria-dei-rossi-app`, `feat/ux-alignment` (from `origin/main`)
- **Author:** architect · **Date:** 2026-11-15 (updated the same day with the lead's rulings, see §7)
- **Source rulings:** `docs/ux/costi-design-system.md` §10.4 (emphasis and slots) and §10.5 (print). §10.5 now carries the print-fill rule (lead, 2026-11-15, merged on `main` as `9177a92e`). Step 6 has been checked against the merged §10.5 text on `origin/main` (2026-11-15) and matches it.

## 1. Goal and scope

- **Goal:** bring the code in line with three fixed design rulings: rename LedgerRow's end slot, set six key figures in `<strong>`, and print in black on white.
- **In scope:**
  1. Rename `LedgerRow`'s `badge` prop to `trailing`, with no alias. Its DOM hook `data-ledger-badge` becomes `data-ledger-trailing` in the same rename.
  2. Put six figures in `<strong>`: on-hand (detail page), count net, waste total, the Home payables amount, the Chiusura app total and the Chiusura per-service totals.
  3. Replace the colour-free `@media print` block with the Costì print palette, the print-fill rule, and the updated e2e pin.
- **Out of scope:**
  - any other look change;
  - `supabase/`, `src/server/`, `src/app/api/`, `public/sw.js`, `src/proxy.ts`, `next.config.ts`, `.github/` and package files;
  - `docs/` beyond this plan (ADR-027 is amended separately, see D3);
  - Figma ("Show badge" becomes "Show trailing" later, the designer's action).

## 2. Current state

**LedgerRow** is in `src/components/ui.tsx:263-322`. The `badge` prop is declared in the `LedgerRowProps` union (`:272`, `:273`), destructured at `:285` and rendered at `:302-306` inside `<span data-ledger-badge="">`. The doc comment at `:265-269` still says "badge". Grepping `src/`, `tests/` and `e2e/` finds these users of the prop or its hook:

| Kind | File:line | Use |
|---|---|---|
| Caller (the only one) | `src/components/dashboard/payables-tile.tsx:46` | `badge={<span className="num font-bold">{formatEur(item.amountEur)}</span>}` |
| Unit test | `tests/components/ledger-row.test.ts:12, 13, 18, 29, 34, 50` | describe/it titles, `badge:` props, `[data-ledger-badge]` |
| Unit test | `tests/components/dashboard-tiles.test.ts:247` | `data-ledger-badge=""` (trailing-slot order check) |
| e2e | none | (`data-badge="lot-missing"` in `e2e/trace.spec.ts:217` and `e2e/xml-invoice.spec.ts:43` is the review-line Badge, not LedgerRow) |

The other 60-odd `LedgerRow` uses are free-form (`children`) and do not change. `badge=` at `src/app/(owner)/page.tsx:136` is a prop of `HomeAlertsView`, not of `LedgerRow`. The `badge:` keys in `src/lib/invoices/upload-result.ts` and `home-alerts.tsx` are unrelated too.

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

**Print** is one `@media print` block in `src/app/globals.css:303-325`. It sets A4, `color-scheme: light` and the hidden slots. Its comment says "No colour is defined here", and `tests/components/print-css.test.ts:66-69` enforces that. Paper therefore takes whichever light palette is active: the osteria `@theme` at `:20-45` or the Costì `:root:has([data-brand="costi"])` at `:111-136`. Both dark blocks (`:76`, `:147`) are limited to `screen and (prefers-color-scheme: dark)`.

The header band is `.band` (`globals.css:218-234`, a grain `background-image`). `HeaderBand` sets `--color-band` / `--color-band-ink` **inline** for the venue layer (`src/components/header-band.tsx:25-28`). Charts fill their bars with `accent` / `danger` on a `sunk` track (`globals.css:387-405`, `src/components/charts/*`); they appear on `/report` (`kpi-panel.tsx`) and on dashboard tiles.

**Filled controls and surfaces** (the elements the print-fill rule D1 targets), found by grepping `src/` for fill classes:

| Fill | Where (file:line) | Selector it gives |
|---|---|---|
| Badge, all six tones (neutral `bg-sunk`, highlight `bg-highlight`, tones `bg-*-bg`) | `src/components/ui.tsx:327-356` (`<span data-tone=…>`) | `span[data-tone]` (the Chiusura difference `p[data-tone]` at `chiusura/difference-card.tsx:37` has no fill and is excluded by the `span`) |
| Primary button | `ui.tsx:136` (`Button` primary) | `.bg-accent` |
| Primary link | `ui.tsx:30` (`primaryLinkClass`), `magazzino/conteggi/start-count.tsx:11` | `.bg-accent` |
| Selected split choice | `tavoli/comanda/split-panel.tsx:130, 155` | `.bg-accent` |
| Plate-cost bar | `src/components/cost/plate-breakdown.tsx:24` | `.bg-accent` |
| Coral edge of a card | `ui.tsx:252` (`Card edge`, 4 px span) | `.bg-gold` (the heading underline `after:bg-gold` at `ui.tsx:214` and `login-screen.tsx:62` is a mark, not a fill; it prints as a black rule) |
| Ink-filled selected segment | `src/components/segmented-control.tsx:47` (`bg-ink text-paper`) | `.bg-ink` |
| Other ink-filled controls | `produzione/forecast-panel.tsx:95` (chip `bg-ink text-surface`), `src/components/nav/nav-classes.ts:10, 16, 21` (current pill, tab, sidebar link; inside `nav`, hidden on paper anyway) | `.bg-ink` (the scrims `bg-ink/40` are another class and are not matched) |
| Tone notes | `ui.tsx:173, 176, 184, 203` (`warningNoteClass`, `dangerNoteClass`, `InfoNotice`, `SuccessNote`); `demo-banner.tsx:15`, `request-form.tsx:305`, `mfa/live-error.tsx:9`, `sync/sync-badge.tsx:29`, `Button` danger `ui.tsx:143` | `.bg-success-bg`, `.bg-warning-bg`, `.bg-danger-bg`, `.bg-info-bg` |

**Print assertions in `tests/` and `e2e/`:**
- `e2e/exports.spec.ts:217-257`, test "on paper … light ink …". The pin at `:247-249` expects body `rgb(31, 41, 51)` on `rgb(247, 248, 246)`. The header comment at `:24` reads "light ink on paper".
- `tests/components/print-css.test.ts:36-70` checks: one block, A4/12 mm, hidden slots, `color-scheme: light`, and **no colour** (`:66-69`). Lines `:72-85` check that both dark palettes are screen-only.
- `tests/components/monthly-pack.test.ts:237-265` checks only where `data-print="hide"` sits. It is unaffected.
- Every other `emulateMedia` call in `e2e/` sets `colorScheme` only, never `media: "print"`.

## 3. Design

### 3.1 LedgerRow `trailing`
- In `LedgerRowProps`, `badge?: ReactNode` becomes `trailing?: ReactNode` in both union arms (`trailing?: never` in the free-form arm). The destructured name and the render condition change with it.
- `<span data-ledger-badge="">` becomes `<span data-ledger-trailing="">`. The doc comment says "trailing slot (an amount or a badge)".
- There is no alias. Strict TypeScript then flags any missed caller at `npx tsc --noEmit`.

### 3.2 `<strong>` for the six figures
- **Rule.** The figure goes in a plain `<strong>`, and the `font-bold` that styled it is removed. Tailwind v4 preflight sets `strong { font-weight: bolder }`, and all six parents are weight 400, so the computed weight stays 700 and the look is unchanged. If a parent kept `font-bold`, `bolder` would compute to 900, a hidden drift (Inter 900 is not loaded). Other classes stay: `num` remains on F4's element (`<strong className="num">`).
- **F1–F3:** `<span className="font-bold">X</span>` becomes `<strong>X</strong>` inside the existing `FactRow` (`dd.num`). For F1 this is the detail-page figure only (D2).
- **F4:** `trailing={<strong className="num">{formatEur(item.amountEur)}</strong>}`. The overdue / due-soon sentences above the list (`payables-tile.tsx:25-37`) are not touched.
- **F5:** `<p className="text-xl tabular-nums"><strong>{t("dayClose.app.total", …)}</strong></p>`. The whole line goes in `<strong>` because it is already bold today, so the look stays the same. The `<strong>` is then the leaf element that the exact-text helper in `day-close-page.test.ts:56-59` finds.
- **F6:** only the amount goes in `<strong>`; the name, tables and covers are labels and stay regular. A new pure function in `src/lib/services/services-view.ts`:
  ```ts
  export function dayServiceRowParts(service: DayServiceRowInput): { lead: string; amount: string; tail: string }
  ```
  - It formats `dayClose.services.row` with a private-use sentinel in place of `{amount}` and splits on the sentinel, so the amount's position comes from the message in any locale.
  - The open-tables suffix goes in `tail`.
  - `dayServiceRow` becomes `lead + amount + tail`, so its existing tests still hold.
  - The card renders `{lead}<strong>{amount}</strong>{tail}`, and the row's `textContent` stays the same.
  - No i18n string changes.

### 3.3 Print palette (one global block)
- **The values live in code twice, kept equal by a test**, as the screen tokens already are:
  - add `PRINT_COLORS: Record<ColorToken, string>` (all 25 tokens) to `src/lib/design/tokens.ts`;
  - inside the existing single `@media print` block in `globals.css`, add `:root, :root:has([data-brand="costi"]) { --color-…: #RRGGBB; … }`.

  That selector has the same specificity as the Costì block and comes later, so it wins over both the osteria and the Costì light palettes.
- **Values:**

| Tokens | Print | Basis |
|---|---|---|
| `ink` | `#000000` | §10.5 |
| `ink-muted` | `#404040` | §10.5 |
| `paper`, `surface`, `sunk` | `#FFFFFF` | §10.5 |
| `rule`, `rule-strong` | `#000000` | §10.5 (widths unchanged) |
| `gold` (Coral marks), `success`, `warning`, `danger`, `info`, `accent-ink`, `focus` | `#000000` | §10.5 ("Coral and the other tones") |
| `band` / `band-ink` | `#FFFFFF` / `#000000` | §10.5 (no band background) |
| fills `highlight`, `accent`, `accent-hover`, `success-bg`, `warning-bg`, `danger-bg`, `info-bg` | `#FFFFFF` | D1 (fills go white) |
| words on fills `on-highlight`, `on-accent` | `#000000` | D1 (text is black) |

- **Print-fill rule (D1).** In print, every fill turns white, its text turns black, and a 1 px black line keeps its shape. One rule inside the print block covers the selectors in §2 "Filled controls and surfaces":
  ```css
  span[data-tone], .bg-accent, .bg-highlight, .bg-gold, .bg-ink,
  .bg-success-bg, .bg-warning-bg, .bg-danger-bg, .bg-info-bg {
    background-color: var(--color-paper) !important;
    color: var(--color-ink) !important;
    outline: 1px solid var(--color-ink);
    outline-offset: -1px;
  }
  ```
  - **Why `.bg-ink` is here.** The selected segment and the other ink-filled controls set `bg-ink text-paper` (or `text-surface`). With `ink` at `#000` and `paper` / `surface` at `#FFF`, they would otherwise print as a black fill with white text, and that text vanishes when the browser omits backgrounds.
  - **Why `color` is on the rule.** It overrides `text-paper` / `text-surface` on those controls.
  - **Why an outline, not a border.** The 1 px line is drawn as an outline inset by 1 px. It reads as a 1 px border, follows the rounded corners, and changes neither the layout nor the borders some of these elements already have (the notes' 4 px left rule, the 1.5 px danger-button and sync-badge borders).
  - **What the rule does not touch.** Badge dots (`bg-on-highlight`, `bg-<tone>`) stay black dots. The heading underline (`after:bg-gold`) prints as a black rule.
- **Band.** Add `.band { --color-band: var(--color-paper) !important; --color-band-ink: var(--color-ink) !important; background-image: none; }`. The `!important` beats the venue layer's inline custom properties. The 2 px `border-gold` rule under the band prints black.
- **Shadows.** Add `*, *::before, *::after { box-shadow: none !important; text-shadow: none !important; }`.
- **Charts.** With `accent` printing white, bars would vanish, so add `[data-chart-value] { fill: var(--color-ink); }`. This mirrors the forced-colors block, and the BarTable numbers still carry the meaning.
- **Comment.** The block comment changes from "No colour is defined here" to "Costì print palette and print-fill rule (costi-design-system §10.5), mirrored in `PRINT_COLORS`".
- **Components.** No component changes. The rule targets classes and attributes the components already render, and a new test pins that link (step 6, check h).

### 3.4 Data model / API
None. There are no migrations, routes or server changes.

## 4. Alternatives considered

- **A compatibility alias (`badge` as a deprecated synonym).** Rejected by the ruling: there is no production data and only one caller, and strict TypeScript catches every miss.
- **Keeping `data-ledger-badge` and renaming only the prop.** Rejected: a slot called "trailing" in code and "badge" in the DOM is the drift this pass removes. Only two unit tests read the attribute.
- **F6: `<strong>` around the whole service row.** Rejected: it would make the name and counts bold too, a larger visible change than the ruling asks for. §10.4 reserves bold for the figure.
- **F6: `indexOf(amount)` on the finished string.** Rejected: it breaks if a service name contains the same amount text. The sentinel split does not depend on the content.
- **Print colours as `var()` references to existing tokens only (no hex in the block).** Not possible: `#000`, `#404040` and `#FFF` are not screen token values. Mirroring them in `PRINT_COLORS` keeps the house rule that every colour sits in `tokens.ts` behind a drift test.
- **The print-fill line as a real `border: 1px solid`.** Rejected: it adds 2 px to every box. It would also replace the notes' 4 px left rule and the 1.5 px borders, which the ruling does not ask for. An inset outline draws the same 1 px line without either effect.
- **Print-fill hooks as new `data-print-fill` attributes on each component.** Rejected: that touches about ten components for a CSS-only rule. Class selectors cover every current and future use of the fill classes, and step 6 (h) fails if a component stops rendering them.
- **Black fills with white words, forced with `print-color-adjust: exact` (former V1).** Rejected by the lead (D1).
- **A second print block (for example one per page).** Rejected: the ruling and ADR-027 ask for one global block, and the `print-css.test.ts` check "exists exactly once" stays.

## 5. Build plan

Each step is one commit. Write the test change first and see it fail (red), then make the code change (green). After each step, run `npx tsc --noEmit`, `npm run lint` and `npm test`; step 7 also runs e2e.

| # | Step (one commit) | Files | Test that proves it (written first, red before the change) |
|---|---|---|---|
| 1 | LedgerRow: `badge` → `trailing`, `data-ledger-badge` → `data-ledger-trailing`, doc comment | `src/components/ui.tsx`, `src/components/dashboard/payables-tile.tsx` (prop name only), `tests/components/ledger-row.test.ts`, `tests/components/dashboard-tiles.test.ts:247` | **`ledger-row.test.ts`:** every `badge:` becomes `trailing:`; `[data-ledger-badge]` becomes `[data-ledger-trailing]`; the titles say "trailing"; a new `@ts-expect-error` case shows `{ title: "T", badge: "x" }` is no longer a valid `LedgerRowProps`.<br>**`dashboard-tiles.test.ts:247`:** looks for `data-ledger-trailing=""`.<br>**Red before the change:** wrong attribute, and an unused `@ts-expect-error`. `tsc` proves there is no other caller. |
| 2 | F4 payables amount → `<strong className="num">` | `src/components/dashboard/payables-tile.tsx:46`, `tests/components/dashboard-tiles.test.ts:253` | `:253` regex becomes `/<strong class="num">[^<]*\d[^<]*€<\/strong>/`, and the trailing slice must contain no `font-bold`. `:221-228` is unchanged (text). |
| 3 | F1, F2, F3 (the P2f figures) → `<strong>` | `magazzino/[ingredientId]/page.tsx:183`, `scostamenti/variance-row.tsx:50`, `sprechi/waste-costs.tsx:40`; `tests/components/ingredient-facts.test.ts:65`, `variance-row.test.ts:112`, `waste-costs.test.ts:59` | **`ingredient-facts`:** `fact-on-hand` has a `strong` child with text `12,3 kg` and no `.font-bold`.<br>**`variance-row:112`:** `/<dd[^>]*><strong>[^<]*€[^<]*<\/strong><\/dd>/`, test title "the net in <strong>".<br>**`waste-costs:59`:** `<strong>15,00 €</strong>` inside the `dd`.<br>The e2e `toHaveText` pins (§2) stay green with no change. |
| 4 | F5 Chiusura app total → `<p className="text-xl tabular-nums"><strong>…</strong></p>` | `src/app/(owner)/chiusura/page.tsx:159-165`, `tests/components/day-close-page.test.ts` | New assertion in the test "shows the app's total…" (`:92-99`): `byText(nb("Totale app 1.234,50 € · 3 tavoli · 6 coperti")).tagName === "STRONG"`, and its parent `p` has no `font-bold`. Existing `:67, :94, :182` stay green. |
| 5 | F6 per-service totals: `dayServiceRowParts` + `<strong>` on the amount | `src/lib/services/services-view.ts`, `src/app/(owner)/chiusura/services-card.tsx:45-49`, `tests/lib/services/services-view.test.ts`, `tests/components/day-close-services.test.ts` | **`services-view.test.ts`**, new `describe("dayServiceRowParts")`:<br>• `lead + amount + tail === dayServiceRow(...)` for 0, 1 and 3 open tables;<br>• `amount` is `nb("18,00 €")`;<br>• `tail` holds the open-tables words;<br>• a service named `"18,00 €"` still splits on the real amount;<br>• the `en` locale works.<br>**`day-close-services.test.ts`:** every `[data-service-key]` has exactly one `strong`, whose text is the row's amount; `:78-81` `textContent` is unchanged. |
| 6 | `PRINT_COLORS` in tokens; in the one print block: palette, print-fill rule, band, shadows, chart rule | `src/lib/design/tokens.ts`, `src/app/globals.css:303-325`, `tests/components/print-css.test.ts`, new `tests/components/print-fills.test.ts` (jsdom) | **`print-css.test.ts`**: the guard "defines no colour of its own" (`:66-69`) is **replaced** by checks (a) to (g):<br>(a) one `:root, :root:has([data-brand="costi"])` rule, whose `--color-*: #RRGGBB;` declarations equal `PRINT_COLORS` for all 25 `COLOR_TOKENS`;<br>(b) `PRINT_COLORS` holds the §3.3 values;<br>(c) `contrastRatio(ink-muted, paper) ≥ 9`, and every pair in `CONTRAST_PAIRS` meets its minimum with `PRINT_COLORS`, except the named pairs whose foreground is a fill turned white (`accent` on `paper` / `surface`, `tokens.ts:273-274`; their shape is carried by the outline, which check (g) asserts);<br>(d) a `.band` rule sets `background-image: none` and `--color-band` with `!important`;<br>(e) a universal rule sets `box-shadow: none !important`;<br>(f) `[data-chart-value]` gets `fill: var(--color-ink)`;<br>(g) one rule lists exactly the selectors in `PRINT_FILLS` (exported from the test helper: `span[data-tone]`, `.bg-accent`, `.bg-highlight`, `.bg-gold`, `.bg-ink`, `.bg-success-bg`, `.bg-warning-bg`, `.bg-danger-bg`, `.bg-info-bg`) and declares `background-color: var(--color-paper) !important`, `color: var(--color-ink) !important`, `outline: 1px solid var(--color-ink)` and `outline-offset: -1px`.<br>The existing A4, hidden-slot, one-block, `color-scheme` and screen-only-dark tests stay.<br>**`print-fills.test.ts`**:<br>(h) renders each filled component and asserts `element.matches(PRINT_FILLS.join(","))`: `Badge` in all six tones, `Button` primary, a `primaryLinkClass` link, the selected `SegmentedControl` tab (`aria-selected="true"`, the `.bg-ink` case), `Card edge`'s edge span, `InfoNotice`, `SuccessNote`, `ErrorAlert` and an element with `warningNoteClass`;<br>(i) the difference card's `p[data-tone]` and an unselected segment do **not** match. |
| 7 | e2e pin: black on white | `e2e/exports.spec.ts:24, 217, 239, 247-249` | Title and comments change from "light ink" to "black ink on white". Pin: body `color` `rgb(0, 0, 0)`, `background-color` `rgb(255, 255, 255)`. Added: the header band (`.band`) has `background-image` `none`, and a `.rounded-card` has `box-shadow` `none`. Red on `main`, green once step 6 is in. Run `npx playwright test e2e/exports.spec.ts`, then the full suite. |

Write step 7's failing pin before step 6's CSS, but keep the two as separate commits so the e2e change can be reviewed on its own.

### 5b. Variants

None. V1 (black fills with white words, `print-color-adjust: exact`) was rejected by the lead on 2026-11-15 (D1). V2 (the stock list's on-hand total in `<strong>`) was rejected the same day (D2).

## Lists touched (guard and list tests in `tests/` and `e2e/`)

| Test | Effect |
|---|---|
| `tests/components/print-css.test.ts` | **Guard replaced** (step 6). "Defines no colour of its own" becomes "declares exactly `PRINT_COLORS`" plus the print-fill selector list (`PRINT_FILLS`). This does not weaken the guard: the replacement checks every value and selector. The one-block, A4, hidden-slot list (`PRINT_HIDDEN`), `color-scheme: light` and screen-only-dark checks are unchanged. |
| `tests/components/print-fills.test.ts` (new) | **New list guard** (step 6): every filled component matches `PRINT_FILLS`. |
| `e2e/exports.spec.ts` T1 (`:217-257`) | Pin changed to black on white (step 7). |
| `tests/components/ledger-row.test.ts` | Component contract renamed (step 1). |
| `tests/components/dashboard-tiles.test.ts:230-255` | Slot attribute and amount element (steps 1–2). |
| `tests/lib/design/tokens.test.ts` | Unchanged and must stay green. Its `globals.css` slices end at `@layer base` (`:190-240`), and the print block comes after that, so the new `--color-*` lines fall outside every slice. The accent-only-as-text guard (`:151-176`) is unaffected: the print block has no `color: var(--color-gold)`. |
| `tests/components/costi-theme.test.ts:93-100` | List of files that may name `data-brand`. `app/globals.css` is already on it. Unchanged. |
| `tests/lib/design/sala-contrast.test.ts:14`, `tests/design/kitchen-contrast.test.ts:30` | Read specific `[data-contrast="high"]` rules. The print rules are separate rules inside `@media print`. Unchanged; confirm they stay green. |
| `tests/components/badge.test.ts`, `segmented-control.test.ts`, `card.test.ts`, `info-notice.test.ts` | Unchanged (no component changes). They keep pinning the classes that `PRINT_FILLS` targets. |
| `tests/components/costi-theme-order.test.ts` (route-group list) | Not affected: no route group changes look. |
| `tests/components/monthly-pack.test.ts:237-265` (`data-print="hide"` placement) | Not affected. |

## 6. Risks and mitigations

- **Hidden weight drift.** If a parent keeps `font-bold`, `strong` computes to 900. The plan removes `font-bold` from each of the six figures. Steps 2–4 assert that it is gone from the figure (and, for F5, from its `p`); F6's `li` never had it.
- **Print overrides losing to inline or more specific rules.**
  - The venue band's inline variables are beaten by `!important` (step 6), and step 7 asserts the result.
  - The Costì root has the same specificity as the print rule, which comes later in the file.
  - A future third palette selector would have to be added to the print rule; step 6 (a) fails if that rule's selector list changes.
- **A new filled control that the print-fill rule misses.** The rule matches classes, so any new use of `bg-ink`, `bg-accent`, `bg-highlight`, `bg-gold` or a tone `-bg` is covered automatically. A fill made another way (an arbitrary `bg-[…]` value or an inline style) would print as screen tokens allow. Step 6 (h) lists today's components, and a new filled component should be added there.
- **Shape on paper.**
  - The two "primary button shape" pairs (`accent` on `paper` / `surface`) are named exceptions in step 6 (c) only because the fill itself turns white. The shape is not lost: the 1 px outline draws the button, the primary link, badges, notes, the Coral edge and the selected segment, and step 6 (g)/(h) prove that.
  - Chart bars are covered by the `[data-chart-value]` rule. Chart tracks go white on white, but the BarTable figures carry the meaning (ADR-021).
  - Inset-ring borders (the kitchen high-contrast badge ring) are not on printed screens.
- **Browser variance.** Chromium is the only engine pinned, as ADR-027 already notes. Browsers leave out backgrounds when printing unless the user turns them on ([MDN `print-color-adjust`](https://developer.mozilla.org/en-US/docs/Web/CSS/print-color-adjust)). D1's white fills with black words and lines print the same either way. Outlines follow `border-radius` in current engines; an engine that draws square outlines would only square the corners on paper.
- **Security / privacy:** no auth, data, route, secret or personal-data change. The pass is CSS, markup and one pure string helper; payloads and RLS are untouched. No secrets are involved.
- **Dependencies:** none added.

## 7. Decisions (lead, 2026-11-15)

- **D1, print fills (was Q-1).** Ruled as the default and written into `costi-design-system.md` §10.5 (`9177a92e`). In print, fills go white, text goes `#000`, and a 1 px `#000` line keeps the shape. This covers badges, the primary button and link, Coral edges, tone backgrounds and the ink-filled selected tab (SegmentedControl's selected segment and every other `bg-ink` control). Implemented in step 6. V1 (black fills) is rejected.
- **D2, on-hand scope (was Q-2).** Only the detail-page figure (`fact-on-hand`, F1) gets `<strong>`. The stock list row total (`magazzino/stock-row.tsx:29`) and the payables tile's overdue / due-soon sentences stay as they are. V2 is rejected.
- **D3, docs (was Q-3).** Builder 1 amends ADR-027 decision 5 ("light palette" → the Costì print palette, black on white) in a separate docs-only PR. This pass does not touch `docs/` beyond this plan.

**Open questions:** none.
