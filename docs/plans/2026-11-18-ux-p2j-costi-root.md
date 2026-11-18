# Tech plan — Osteria Dei Rossi app · P2j: Costì is the `:root` default (costi-design-system §11 step 9)

- **Client slug / internal:** `osteria-dei-rossi` · **Branch:** `feat/ux-p2j-costi-root` (cut from `origin/main`) · **Pattern:** P2b–P2i
- **Author:** architect · **Date:** 2026-11-18
- **Sources:**
  - `docs/ux/costi-design-system.md` §1, §9, §10, §11 step 9;
  - `docs/plans/2026-11-14-ux-p2-design-system.md`: D4, D5, D11, P2j-1/2, §5c, and DS-BQ-1 (approved by the lead: Q-L1);
  - `docs/plans/2026-11-18-ux-p2h-costi.md` and `docs/plans/2026-11-18-ux-p2i-prenota.md`;
  - the lead's additions of 2026-11-18: the paper-on-ink `use` text and the three held P2i review notes.
- **Scope:** UI only. That means `src/app/**` pages, layouts and components (not `src/app/api`), `src/components/**`, `src/lib/design/**`,
  `src/app/globals.css`, `src/app/fonts/**`, `tests/**` (no `tests/config/**` change) and `e2e/**`.
- **No ADR:** ADR-045 already records the decision; this PR only finishes it.

## 1. Goal and scope

- **Goal:** one theme. The Costì values become the `:root` values. The osteria theme, its fonts, the `data-brand` marker and the order guard
  are deleted, and no re-skinned screen changes how it looks.
- **In scope:**
  - `globals.css` keeps one light block (`@theme`), one screen-dark block and the print palette; no other block declares a colour;
  - `THEMES`, `BRAND` and `DERIVED` are deleted from `tokens.ts`;
  - `CostiTheme`, its 26 marker-only layouts and every use of it are deleted;
  - the Bodoni Moda and Figtree files are deleted, and Montserrat and Inter become the preloaded root faces;
  - the guard and list tests move to "there is one theme";
  - the lead's additions (§5 steps 1–2, and note (b) in step 5).
- **Out of scope:**
  - docs (§3c lists the statements that become false, for the designer or the lead);
  - the guest e-mails (`src/server/reservations/mail/templates.ts`, P2i's build-queue item, still open);
  - the venue layer (§9): unchanged;
  - the print palette (§10.5): unchanged except for its selector;
  - any new token name.
- **Build queue for builder 1:** none. Deleting the fonts and themes needs no change to `next.config.ts`, `src/proxy.ts`, `public/sw.js`
  (it names no font file), `.github/` or the package files.

## 2. Current state (origin/main, read 2026-11-18)

| Area | Files | What they do now |
|---|---|---|
| Tokens, runtime | `src/app/globals.css` | • `@theme` = osteria light (`:12-60`)<br>• `@theme inline`: font stacks ending in `"Figtree"` / `"Bodoni Moda"` (`:66-70`)<br>• screen-dark `:root` = osteria dark (`:76-105`)<br>• `:root:has([data-brand="costi"])` = Costì light + 4 font remaps (`:111-144`), and its screen-dark twin (`:147-176`)<br>• the print palette on `:root, :root:has([data-brand="costi"])` (`:361-388`)<br>• high contrast (`:445-465`) |
| Tokens, mirror | `src/lib/design/tokens.ts` | • `BRAND`, `DERIVED`, `THEMES` (osteria)<br>• `PRODUCT_THEMES` takes its 16 status tones from `THEMES` (`:201-208`, `:228-235`)<br>• `PRINT_COLORS`, `CONTRAST_PAIRS` (paper on ink at `:290`), `HIGH_CONTRAST_PAIRS` |
| Venue layer | `src/lib/design/venue-layer.ts` | Imports `PRODUCT_BRAND` and `PRODUCT_THEMES` only. Unchanged |
| Manifest | `src/lib/brand/manifest.ts` | Uses `PRODUCT_THEMES.light.band` / `.paper`. Unchanged |
| Root layout | `src/app/layout.tsx` | • Six `localFont` faces: Bodoni and Figtree (preloaded), their latin-ext twins, and Montserrat and Inter (`preload: false`, variables `--font-product-*`)<br>• `themeColor` = venue band `#1C4130` in both schemes |
| Marker | `src/components/costi-theme.tsx` | `<span data-brand="costi" hidden />` |
| Marker users (33 files) | • **26 marker-only layouts** under `src/app/(owner)/`: `altro`, `anagrafiche`, `avvisi`, `chiusura`, `costi`, `cucina`, `dispositivi`, `doppia-verifica`, `fatture`, `impostazioni`, `magazzino`, `margini`, `menu`, `pagamenti`, `password`, `personale`, `prenotazioni`, `produzione`, `registro`, `report`, `ricette`, `riordino`, `sicurezza`, `spingere`, `tavoli`, `tracciabilita`<br>• `(owner)/page.tsx` (3 renders)<br>• `(public)/prenota/[slug]/page.tsx` and `(public)/prenota/[slug]/annulla/page.tsx`<br>• `(public)/login/layout.tsx`, `(public)/dispositivo/layout.tsx` and `(platform)/console/layout.tsx`: these also export `viewport`, and login and dispositivo render `ProductLogo` | Each one switches the whole page to Costì |
| Fonts | `src/app/fonts/` | Bodoni Moda ×2, Figtree ×4, Montserrat ×1, Inter ×2, four OFL files and a README |

**Screens without the marker today.** Removing the osteria theme changes these on purpose:

| Screen | Reached by | Change |
|---|---|---|
| Root 404 (`src/app/not-found.tsx`) | • an unknown URL, signed in or out (`/non-esiste-questa-pagina`)<br>• a missing static file under the static policy (`/brand/costi/missing.png`)<br>• `notFound()` in `src/app/(owner)/tavoli/[sessionId]/page.tsx` | • Background: cream → Off-white in light, osteria dark → Charcoal in dark<br>• Ink: black → Charcoal<br>• h1: Bodoni → Montserrat; body: Figtree → Inter<br>• Rule under the band: gold → Coral; focus: Costì<br>• The band keeps the venue layer |
| `src/app/global-error.tsx` | A server error | Not expected to change: it draws its own `<html>` with an inline system font and no token class. Its body background would read `var(--color-paper)` only if the root stylesheet reached it. No test pins it, so it is checked by hand (step 5) |

`/pin` only redirects to `/login`, so it is not in the list.

**One motion change on the re-skinned pages, also on purpose.**
- The hidden span was child 1 of `main`, so the `.reveal` stagger started at child 2.
- Without it, every page's first visible child rises 40 ms earlier.
- The final look is the same, and nothing changes under reduced motion.
- `reveal-through.test.ts` pins the new positions.

## 3. Design

### 3a. End state

**`globals.css`**
- `@theme {` holds the tap tokens and the `PRODUCT_THEMES.light` colours. `@theme inline` follows it: `ux-quick-wins-preserves.test.ts`
  (config) slices from `@theme {` to `@theme inline`, so that order stays.
- `@theme inline` sets:
  - `--font-sans: var(--font-body), ui-sans-serif, system-ui, sans-serif`;
  - `--font-display: var(--font-display-face), ui-sans-serif, system-ui, sans-serif`.
- The screen-dark block is `@media screen and (prefers-color-scheme: dark) { :root { color-scheme: dark; …PRODUCT_THEMES.dark } }`.
- There is no `:has(` block and no `data-brand`.
- Print has one `:root` rule, with `color-scheme: light` and the 25 `PRINT_COLORS`. The rest of the print block stays byte-equal, and so do
  high contrast, forced-colors and `.band`.

**`tokens.ts`**
- It keeps:
  - `COLOR_TOKENS`, `mix`, `PRODUCT_BRAND` and `PRODUCT_DERIVED`;
  - `PRODUCT_THEMES`, under that name, because `costi-brand-docs.test.ts`, `venue-layer.ts`, `manifest.ts` and the docs use it;
  - `PRINT_COLORS`, the pairs and the thresholds.
- The status tones in `PRODUCT_THEMES` become the hex literals they resolve to today. No value changes.

**Fonts**
- `montserrat` uses `variable: "--font-display-face"` and `inter` uses `variable: "--font-body"`.
- Both are preloaded (the default) with `adjustFontFallback: "Arial"`.
- These are the two names `root-layout.test.ts` and `fonts.test.ts` already pin. `--font-product-*` and the `-ext` variables go, with no
  alias.
- The files are full-charset (README), so there is no latin-ext split any more.

**Unchanged**
- The venue layer: `HeaderBand`'s two inline variables, and `VENUE_LAYER_DEFAULT` in `venue-layer.ts`.
- The theme colours: the root `themeColor` (`#1C4130`), the Forest `themeColor` on the login, dispositivo and console layouts, and the
  manifest colours and icons.
- CSP: `font-src 'self'`, and the preload links are same-origin.
- No data path is touched, so waiters still see no costs.

### 3b. Guard and list tests: what each becomes

| Test | Becomes | Why it is not weaker |
|---|---|---|
| `tests/components/costi-theme-order.test.ts` | **Deleted** in step 6. Its rules move to `tests/components/one-theme.test.ts` (new) | The order no longer exists. The new test is stricter (next row) |
| `tests/components/one-theme.test.ts` (new, step 6, plus (d) in step 7) | (a) No `src/**/*.{ts,tsx,css}` file matches `/data-brand\|CostiTheme\|costi-theme\|bodoni\|figtree/i`, and `src/components/costi-theme.tsx` does not exist.<br>(b) The D5 rules apply to **every** file under `src/app/` except `api/`, where they used to cover only the eight step roots: no `<dl`, no `role="tablist"`, and no `font-display` outside the same four allow-listed files. This is green today (grep).<br>(c) `globals.css` has no `:has(`, and declares colours only in `@theme`, the screen-dark `:root` and the print `:root`.<br>(d) `tokens.ts` exports no `THEMES`, `BRAND` or `DERIVED` | Stricter: the whole tree and every file, plus deletion checks |
| `tests/components/costi-theme.test.ts` | **Deleted** in step 6:<br>• the `CostiTheme` case and the two R1 cases go, because (a) covers them;<br>• the `ProductLogo` and product-layout cases move unchanged to `tests/components/product-logo.test.ts`, except the child order becomes `["PICTURE","P"]` and `toContain("CostiTheme")` becomes `not.toMatch(/CostiTheme\|data-brand/)` | The logo and `viewport` assertions are equal. The marker assertions are replaced by a tree-wide ban |
| `tests/components/{chiusura,fatture,gestione,magazzino}-layouts.test.ts` | **Deleted** in step 6, with the 18 layouts they import | They pinned "marker + children". Nothing is left to render, and (a) bans the marker everywhere |
| `tests/components/console/console-layout.test.ts:29` | `<p>figlio</p>` exactly | Exact, as before |
| `tests/components/home-links.test.ts:119-147` | The three "renders the marker" cases are deleted | (a) covers `(owner)/page.tsx`. The pending and failed states keep their other cases |
| `tests/components/prenota-pages.test.ts:34-38` | "renders its content first, with no marker": `html` starts with the mocked content | Exact. The title, no-Costì and band cases are unchanged |
| `tests/components/reveal-through.test.ts:7, :125, :139` | No `ReportLayout`; `p` is 5 (owner) and 4 (signed out); the comment at `:15` is updated | Positions are still counted, not assumed |
| `tests/lib/reports/no-money-math.test.ts:10-16` | Nine files become eight (no `layout.tsx`); the title is updated | Exact list |
| `tests/components/print-css.test.ts:79-107` | Step 6: the palette rule is the only print rule whose selector is exactly `[":root"]`, and "others" means every rule but that one | Exact. The 25 values are unchanged |
| `tests/lib/design/tokens.test.ts` | **Step 3:** the status tones are pinned to their 16 literals.<br>**Step 4:** the `globals.css` section expects the `@theme` colours to equal `PRODUCT_THEMES.light` and the dark block to equal `.dark`; the stray guard covers everything outside those two blocks and the print rule.<br>**Step 6:** `splitPrintPalette` matches the print `:root {` rule.<br>**Step 7:** these are deleted: the `BRAND`, `DERIVED` and osteria-palette describes, and the `THEMES` AA loop (the CB4 loop runs the same pairs on the shipped theme). The chart test reads `PRODUCT_THEMES`. The accent-only source scan stays | One theme, pinned exactly |
| `tests/design/kitchen-contrast.test.ts:4, :19` | Step 4: `PRODUCT_THEMES` (DS-BQ-1, Q-L1) | The same pairs at 7:1, on the shipped theme |
| `tests/lib/design/costi-contrast.test.ts` | Comment at `:8` only ("until P2j" removed). `:35` slices from `@theme {` to the `/* Light theme colours` comment, so step 4 keeps that comment above the colours | Equal |
| `tests/lib/design/fonts.test.ts` | Step 5:<br>• `FONT_FILES` has 3 files, and the `*.txt` files in the folder are exactly the 2 OFL files;<br>• `display: "swap"` ×2, `preload: false` ×0, `adjustFontFallback: "Arial"` ×2;<br>• no `Times New Roman`, no `unicode-range`, no `-ext` variable;<br>• the stacks start with `var(--font-body),` and `var(--font-display-face),`, and nothing in `globals.css` remaps a `--font-*` variable;<br>• weights: Montserrat `["600"]`, Inter `["400","700"]`;<br>• the RFN check is unchanged;<br>• the latin-ext test is deleted, because no split remains (the commit says so) | Exact lists |
| `venue-layer.test.ts`, `tests/app/manifest.test.ts`, `tests/app/root-layout.test.ts`, `tests/config/costi-brand-docs.test.ts`, `tests/config/ux-quick-wins-preserves.test.ts` | Unchanged and green | They read `PRODUCT_*` or variable names that stay. **No `tests/config` file changes** |
| `e2e/product-brand.spec.ts:98-124` | **Step 4:** the 404 is Off-white, and `OSTERIA_CREAM` is deleted.<br>**Step 5:** Montserrat and Inter are loaded, with no `bodoni` or `figtree` face; the logo and CSP checks stay. The describe title (held note b) becomes "the venue's pages wear Costì with the venue layer (ADR-045)" | The 404 is pinned in its new look |
| `e2e/fonts.spec.ts:32-37, :89-118` | Step 5: `VENUE_FAMILIES` is deleted. The test becomes "the 404 loads Montserrat and Inter from the app, never Bodoni or Figtree", and the body's first family is Inter | Inverted, same strictness |
| `e2e/app-shell.spec.ts:58-73` | Step 6:<br>• the comments no longer say "coexist";<br>• the Ricette/guest test becomes "every screen wears Costì" and also asserts an Off-white body on an unknown address;<br>• the band test adds `border-bottom-color` = Coral `rgb(255, 122, 92)` | Stricter |
| `e2e/prenota-theme.spec.ts:41` | Step 2: `not.toContainText(/costì/i, { useInnerText: true })` (held note a) | Stricter: Next's flight data can no longer cause a false pass or a false failure |
| The other `e2e/*-theme.spec.ts` files and `reservations-public.spec.ts` | Unchanged and green | They already pin Costì |

### 3c. Docs statements that become false (for the designer or the lead; outside this lane)

`docs/ux/costi-design-system.md`:
- **§1:** "Retired: … until then it stays only on the screens not yet re-skinned". After P2j it stays on no screen.
- **§2**, status row: "product tokens, same as the venue". There is no venue palette; they are Costì literals.
- **§8:** the "Venue screens (osteria theme)" page, the `color · Osteria light/dark` collections and the `osteria/*` text styles. Nothing in
  code backs them any more. The Figma update is the designer's action, already noted in §10.1.
- **§9:** "`VENUE_LAYER_DEFAULT` in `tokens.ts`". It is in `venue-layer.ts` (D6, Q-L9; still open).
- **§10.1**, Costì light row: "before it, the `data-brand="costi"` block".
- **§10.2**, Fonts row: "`--font-product-display` / `--font-product-body`". The variables are now `--font-display-face` and `--font-body`
  (Q2).
- **§11:** "How" (the `data-brand` switch, `CostiTheme` per layout) and "Guards per step" (the shrinking source test).
- **§11a:**
  - its sources, `costi-theme.tsx` and `costi-theme-order.test.ts`;
  - "`border-gold` … still the osteria gold on routes not yet re-skinned";
  - the last row: "`CostiTheme` (hidden marker) and `costi-theme-order.test.ts`".

`docs/design/ui-foundation.md`:
- §1–§3 describe the osteria palette and fonts as current.
- The §11 prose describes the `data-brand` scope.
- The §11 contrast table's `paper` on `ink` row (`:517`) still gives the use "current tab in the owner nav" (step 1).
- Keep the word `data-brand` in §11, and both `data-brand` and `:root:has(` in ADR-042's Decision, as history:
  `tests/config/costi-brand-docs.test.ts` requires them.

`docs/plans/2026-11-14-ux-p2-design-system.md`:
- P2j-3 (E-1 docs) was this builder's exception. With docs outside this lane, it goes to the lead.
- §4.5 steps 3–4 describe the marker.

## 4. Alternatives considered

- **Keep `CostiTheme` as a no-op until a later clean-up.** Rejected: §11 step 9 and rule B say it is removed, and a no-op would be a shim.
- **Keep empty pass-through layouts** so the reveal timing stays exactly as it is. Rejected: they would be dead code. The first child now
  starts 40 ms earlier, which is not a change in look, and a test pins the new positions.
- **Keep `--font-product-*` and point `--font-sans` and `--font-display` at them.** Rejected: that is four extra names for two faces. Reusing
  the two names that are already pinned also removes the `-ext` pair and the remap.
- **Rename `PRODUCT_THEMES` to `THEMES`.** Rejected: a config test, the venue layer, the manifest and the docs use the current name, and the
  config test is outside this lane.
- **Remove the marker before the fonts move.** Rejected: the font remap lives under `:has([data-brand])`, so every screen would fall back to
  Bodoni and Figtree for one commit. The fonts move first (step 5), then the marker goes (step 6).

## 5. Build plan

**Before step 1.**
1. Run `git fetch origin main` and merge. Docs PR #180 is `2ec92edf`.
2. Run `grep -rn "owner nav\|paper. on .ink" docs/ tests/` and record the result in the PR.

Today's worktree has no paper-on-ink row in `costi-design-system.md`, and no test asserts the `use` cell of the `ui-foundation.md` row. If
#180 adds a docs row that a test compares with `pair.use`, the docs row has to match. That edit is outside this lane: it goes to the lead,
and no test is changed.

**One commit per step.** Each step writes its failing test first and ends green.

| # | Step | Files | Test that proves it |
|---|---|---|---|
| 1 | **Paper-on-ink `use` (lead).** At `tokens.ts:290`, `use` is exactly `"current tab in the owner nav; selected segment; picked option (Button selected)"` | `src/lib/design/tokens.ts`, `tests/lib/design/tokens.test.ts` | **New case:** the `paper`/`ink` pair's `use` equals that string; it fails first.<br>**Stays green:** `costi-brand-docs.test.ts`, whose row match ends at the dark ratio |
| 2 | **Held P2i notes (a) and (c).**<br>• (a) The no-Costì check reads `innerText`.<br>• (c) New case, signed out: open `/prenota/osteria-demo-nessuna/annulla?t=x`, wait for the h1 (`publicReservation.cancel.title`) and the `role="alert"` (`…cancel.invalid`), then run `expectCosti`: body in light and dark, venue band with no link, tab title, no Costì logo or text | `e2e/prenota-theme.spec.ts` | **The new case.**<br>**Checks:** `env -u CI npx playwright test --list --forbid-only`; `tests/config/e2e-chromium-channel.test.ts` stays green |
| 3 | **Status tones as literals.** The 16 status values in `PRODUCT_THEMES` stop reading `THEMES`, so step 7 can delete it | `tokens.ts`, `tokens.test.ts` | **Rewritten case:** "status tones" compares the 16 values with literals instead of `THEMES`. It is green before and after the change: this is a pure refactor and no value changes |
| 4 | **Costì colours at `:root`** (DS-BQ-1 lands in this commit).<br>• `@theme` colours ← `PRODUCT_THEMES.light`; screen-dark `:root` ← `.dark`.<br>• The dark `:has` block is deleted. The light `:has` block keeps only its four font remaps until step 5.<br>• The `globals.css` header comment and the `tokens.ts` comments are updated | `globals.css`, `tokens.ts` (comments), `tokens.test.ts`, `tests/design/kitchen-contrast.test.ts`, `e2e/product-brand.spec.ts` | **`tokens.test.ts`:** the `@theme` colours equal `PRODUCT_THEMES.light`, the dark block equals `.dark`, and there is no other colour block; fails first.<br>**`kitchen-contrast`:** ≥ 7:1 in both themes on `PRODUCT_THEMES`.<br>**e2e:** the 404 is Off-white in light and Charcoal in dark, and the band is unchanged.<br>**Stay green:** `ux-quick-wins-preserves`, `costi-contrast`, `print-css` |
| 5 | **Fonts.**<br>• Delete `bodoni-moda-latin-600-normal.woff2`, `bodoni-moda-latin-ext-600-normal.woff2`, `figtree-latin-400-normal.woff2`, `figtree-latin-700-normal.woff2`, `figtree-latin-ext-400-normal.woff2`, `figtree-latin-ext-700-normal.woff2`, `OFL-BodoniModa.txt` and `OFL-Figtree.txt`.<br>• `layout.tsx`: the two faces of §3a, with a rewritten header comment.<br>• `globals.css`: the stacks of §3a; delete the last `:has` colour/font block.<br>• `fonts/README.md`: delete the six Bodoni/Figtree rows and their OFL line; the Costì section no longer says "only in the product look".<br>• `src/components/brand.tsx:6`: the comment no longer says "cream".<br>• Held note (b): the describe title | the files named, `fonts.test.ts`, `e2e/fonts.spec.ts`, `e2e/product-brand.spec.ts` | **`fonts.test.ts`:** rewritten as in §3b; fails first.<br>**e2e:** `/login` and the 404 load Montserrat and Inter, with no Bodoni or Figtree face and no Google host; on the static 404, the only CSP lines are `script-src`.<br>**By hand:** with `npm run build && npm start`, force a server error locally, open `global-error`, and put a light-mode screenshot and its body colour in the PR |
| 6 | **Remove the marker.**<br>• Delete `src/components/costi-theme.tsx` and the 26 layouts listed in §2.<br>• Remove the import and `<CostiTheme />` from `(owner)/page.tsx` (3 renders), both prenota pages, and the login, dispositivo and console layouts.<br>• The print rule's selector becomes `:root`, merged with `color-scheme: light`.<br>• Update the comments that mention the marker | the files named; the tests in rows 1–10 of §3b; `tokens.test.ts` (`splitPrintPalette`); `e2e/app-shell.spec.ts` | **`one-theme.test.ts` (a)–(c):** fails first.<br>**Then:** the §3b rewrites.<br>**e2e `app-shell`:** the 404 is Off-white and the band rule is Coral.<br>**Grep:** in `src/`, `tests/` and `e2e/`, only `one-theme.test.ts` names `CostiTheme`, `costi-theme` or `data-brand` |
| 7 | **Delete the osteria tokens.** Remove `THEMES`, `BRAND` and `DERIVED` from `tokens.ts`. The `ACCENT_ONLY` and `PRODUCT_THEMES` comments no longer mention cream or the osteria | `tokens.ts`, `tokens.test.ts`, `tests/lib/design/costi-contrast.test.ts` (comment), `one-theme.test.ts` | **`one-theme.test.ts` (d):** `import * as tokens` has no `THEMES`, `BRAND` or `DERIVED` key; fails first.<br>**Then:** the step-7 deletions in `tokens.test.ts` (§3b).<br>**`npx tsc --noEmit`:** proves no importer is left |
| 8 | **Screenshots and the full run.**<br>• 360 × 740, light and dark: the 404 (the one changed screen) and one re-skinned page per group (unchanged).<br>• The PR description | PR description | All green: `npm run build`, `npx tsc --noEmit`, `npm run lint`, `npm run format:check`, `npm test`, `npx playwright test`.<br>≥ 80 % line coverage on changed code |

### 5b. Variants

None. The #180 check before step 1 can only lead to a hand-off to the lead; it does not change the build.

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| **Font loading.** Montserrat and Inter move from on-demand to preloaded on every page, the 404 included, so first-visit bytes change (this plan gives no figure) | Every screen already uses both faces, so the browser fetches them anyway. Preloading removes the swap flash that D11 deferred. `display: "swap"` and the Arial-adjusted fallback stay. `fonts.spec.ts` checks that every font response is 200 and same-origin |
| **Characters outside latin** (the old latin-ext split) | The Costì files are full-charset (README). The split goes away with the Bodoni and Figtree files. The stacks end in `system-ui, sans-serif` |
| **CSP `font-src`** | Unchanged `'self'`, and the preload `<link>`s are same-origin. The 404 test in `product-brand.spec.ts` still requires no CSP line other than `script-src` under the static policy. No `next.config.ts` or `src/proxy.ts` change |
| **Manifest colours and PWA icons** | `manifest.ts` reads `PRODUCT_THEMES` (kept, same values). The icons in `public/brand/costi/` are untouched. `manifest.test.ts` and the `product-brand` icon test pin both |
| **Browser-bar `theme-color`** | The root `#1C4130` (the venue band) and the product layouts' Forest stay; no `viewport` export changes. The `product-brand` and `console-layout` tests pin them |
| **Dark mode** | One screen-dark `:root` block, with `color-scheme: dark`, pinned to `PRODUCT_THEMES.dark` by step 4. The theme specs check Charcoal on every group. Print keeps `color-scheme: light` |
| **Kitchen high contrast** | The CSS block is untouched. `HIGH_CONTRAST_PAIRS` is checked on `PRODUCT_THEMES` by `kitchen-contrast` (step 4) and by `costi-contrast` |
| **Print** | Same values; the selector becomes `:root` (step 6). The print rule is unlayered, so it still beats the `@theme` layer, and the dark block is screen-only. `print-css`, `print-fills` and `tokens.test` pin the 25 values and the fill rule |
| **The 404** | It is the one screen whose look changes (§2). `product-brand.spec.ts`, `fonts.spec.ts` and `app-shell.spec.ts` pin the new look, and the PR has screenshots |
| **Reveal timing** | The first child rises 40 ms earlier (§2). `reveal-through.test.ts` pins the positions |
| **A hidden importer of a deleted name** | `tsc` (step 7), the grep in step 6 and `one-theme.test.ts` |
| **Security and privacy** | No endpoint, data path, secret or environment variable changes. The secrets stay where they are: Vercel env, Supabase Vault and GitHub environments. The fonts stay self-hosted, with no font provider (GDPR). Waiters see no new figure. No dependency is added or removed |

## 7. Open questions (for the lead)

| # | Question | Default |
|---|---|---|
| Q1 | After step 4, `tests/design/kitchen-contrast.test.ts` and `tests/lib/design/costi-contrast.test.ts` check the same pairs. Keep both? | Keep both (DS-BQ-1 as approved), and merge them in a later tidy-up |
| Q2 | Reusing `--font-display-face` and `--font-body` makes the Fonts row of `costi-design-system.md` §10.2 false. Is that acceptable, with the designer updating the row? | Yes |
| Q3 | Who owns the §3c doc edits, including P2j-3 (E-1) of the project plan, now that docs are outside this lane? | The designer edits `costi-design-system.md`; the lead edits `ui-foundation.md`, ADR-042's status line and the plan annotations |

## 8. Decisions (lead, 2026-11-18)
- **Q1:** merge the two kitchen contrast tests into one file holding the union of their assertions, so no pair is lost. The PR body
  says which file absorbed which.
- **Q2:** keep `--font-display-face` / `--font-body` (no churn). The designer amends §10.2's Fonts row to the real names.
- **Q3:** the designer owns every §3c doc edit in one docs PR after P2j merges, keeping the words `data-brand` and `:root:has(` as
  history. This PR touches no docs except this plan.
- The 40 ms motion shift (the first visible child rises one stagger slot earlier) is accepted. The PR body notes it for the designer.
