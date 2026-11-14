# Tech plan — Costì / Osteria Dei Rossi app · UX phase P2 Design system (one Costì system, venue layer, Direct comanda)

- **Status:** final (lead decisions of 2026-11-14 below) · **Author:** architect · **Date:** 2026-11-14
- **Branch:** `feat/ux-p2-design-system`, cut from `origin/main` 01483a8. `main` was merged in at 6ef9f67 (designer PR #115:
  `docs/ux/costi-design-system.md` §1, §9–§11) and at ee092e6 (designer PR #116: `docs/ux/p3-sala-waiter.md` §10 "Direct comanda").
- **Shape:** one plan, **ten PR-sized slices** (§5), one route group per PR, in the designer's order (`costi-design-system.md` §11). The
  first PR is **P2a** (tokens, venue layer, core components).
- **Sources of truth:**
  - `docs/ux/costi-design-system.md`: §9 venue layer, §10 Figma→code map, §11 re-skin order;
  - `docs/ux/p3-sala-waiter.md` §10: Direct comanda, with the lead's change to §10.3 (see Lead decisions).
  - Where this plan and a spec differ, the difference is a named decision (§3) and is listed for the designer (§10).
- **Builder limits:**
  - **May change:** `src/app/**` pages and components, `src/app/globals.css`, `src/components/**`, `src/lib/i18n/**`, `src/lib/nav/**`,
    client-side `src/lib/**` helpers (`src/lib/design` included), `tests/components/**`, `tests/lib/**`, `e2e/**`.
  - **May not change:** `supabase/**`, `src/server/**`, `src/app/api/**`, `public/sw.js`, `src/proxy.ts`, `next.config.ts`, `.github/**`,
    `package.json` and the lockfile, `tests/helpers/**`, `tests/config/**`, `tests/design/**`. Those changes are in §9.
  - Fonts stay self-hosted; no new dependency.

## 0. Summary

**What changes.** The whole app moves to the Costì design system: Montserrat 600 / Inter 400–700, Off-white / Charcoal surfaces, Forest
primary, Coral accents.
- A venue is a **layer** of exactly three settings: name, optional logo, one accent colour.
- The accent re-values only `--color-band`; `--color-band-ink` is derived from it.
- A pure `venueLayer()` **refuses** an accent if the band-ink contrast is under 4.5:1 or the Coral rule against the band is under 3:1.
  There is no fallback colour.
- The osteria is a code-side constant, typed as the contract that SP9 will later fill from the tenant record.

**How.** The switch already exists: `:root:has([data-brand="costi"])` (ADR-042).
- **P2a** builds the venue layer, splits `ProductScope` into `CostiTheme` (a marker) and `ProductLogo`, and adds the spec's new
  components. Each new component replaces an existing hand-made path.
- **P2b–P2i:** each route group gets `CostiTheme` in its own PR, in the spec's order: Sala → Cucina → Home → Fatture → Magazzino →
  Chiusura/Prenotazioni/Report → Gestione/Anagrafica/Registro → `/prenota`.
- **P2j** makes Costì the `:root` default and deletes the osteria theme, its fonts and the scope.

**The Sala slice (P2b)** also builds **Direct comanda** (`p3-sala-waiter.md` §10):
- A tap on an occupied tile opens its comanda, with the lines open at the top.
- Sent lines fold to one row per course.
- The bar's "Comanda · n righe" button scrolls to the lines.
- The covers actions move into a "Tavolo ▾" disclosure under the header. **"Conto richiesto" stays in the header** as a
  pressed-secondary toggle (lead's change to §10.3).
- A free table opens through a bottom sheet.
- The session panel is deleted. W-c is superseded.
- W2 ("Da inviare · n" on the tile) stays, gated on P3's BQ-1.
- The Comanda/Conto view tabs get the ink fill (W-a extended).

Direct comanda is **frontend-only, with one exception.** §10.2's meta line ("Giulia alle 20:14 · Coperto 4 × 2,50 €") needs the opener
and the coperto in the comanda's read. `GET /api/table-sessions/:id/lines` does not return them today, so that one step waits for
**DS-BQ-2** (§2.6, §9).

**Totals.**
- 39 commits in 10 slices.
- Gated steps:
  - P2b-9 (W2) on P3's BQ-1;
  - P2b-10 (meta line) on DS-BQ-2;
  - P2j-1 on DS-BQ-1 of this plan: `tests/design/kitchen-contrast.test.ts`, two lines.
- No `tests/config/**` change.
- No migration in this builder's work, no new poll, no new secret, no new dependency, CSP header unchanged.

## 1. Context and sources

**Read for this plan:**
- `CLAUDE.md` and `docs/handoff/builder.md`;
- the UX specs: `docs/ux/README.md`, `docs/ux/costi-design-system.md` (after #115), `docs/ux/p3-sala-waiter.md` §2 and §10 (after #116),
  `docs/ux/costi-sign-in.md`;
- `docs/design/ui-foundation.md` §1–§7 and §11;
- the plans:
  - `docs/plans/2026-11-13-costi-product-brand.md`;
  - `docs/plans/2026-11-13-ux-strategy.md` §6 and §9 (9.1, 9.3 DS0–DS8, 9b, 9c);
  - `docs/plans/2026-11-13-platform-saas.md` (SP9 rows, `:587-598`, `:964`);
  - `docs/plans/2026-11-14-ux-p3-sala.md` (layout, BQ pattern, D1 `StickyActionBar`, D4 contrast, D6 names, BQ-1 `unsentCount`);
- ADR-028 (`style-src`) and ADR-042 (product scope);
- the code and tests cited in §2.

### 1.1 In scope

| ID | What | Source |
|---|---|---|
| DSV | Venue layer: contract type + Zod schema, `venueLayer()` with typed refusals, the osteria constant, applied to the header band | `costi-design-system.md` §9; lead decisions |
| DSC | `CostiTheme` (marker) + `ProductLogo` split; route-group re-skin in §11 order; Costì as the `:root` default at the end | `costi-design-system.md` §11 steps 0–9 |
| DSK | Components of `costi-design-system.md` §10.3: `Badge` `highlight` tone (folds `RecommendedBadge`), `Card` `edge`, `InfoNotice`, `SegmentedControl`, `FactList`/`FactRow`. `BrandMark` is retired; `DayPicker` moves | `costi-design-system.md` §10.3 |
| DST | The type ramp of §10.2 on every screen (no Bodoni-sized literals left); tab labels at 15 px (`costi/label-sm`) | `costi-design-system.md` §3, §10.2; strategy F21 |
| DCD | **Direct comanda**: tile tap (§10.1), order screen top to bottom (§10.2), panel actions moved (§10.3 as changed by the lead), unchanged areas (§10.4) | `p3-sala-waiter.md` §10; lead decisions |
| W-a+ | Comanda/Conto view tabs: ink fill for the selected tab | lead decision (P3 Q-L7) |
| W2 | "Da inviare · n" on the tile (**gated on P3 BQ-1**) | `p3-sala-waiter.md` §2, §10.4; P3 plan P3-10 |
| ADR | ADR-045 "One Costì design system; the venue is a layer" (doc step) | this plan, §3 D1 |

### 1.2 Out of scope

- **Tenant theme storage** (no table, API, migration or settings screen): that is SP9. This plan only fixes the contract (§4.2).
- The onboarding wizard (A2), the console (SP3), the chef's-hat pattern (Q-DS4), the Coral button (Q-DS1), the real logo files (BRAND-1).
- Strategy DS7 `StateView` and DS8 per-device theme toggle (§1.3).
- **W-c** (superseded by `p3-sala-waiter.md` §10.4; lead decision).
- "Sposta" and "Unisci" (not built; `p3-sala-waiter.md` §10.3, last row).
- Any path in the "may not change" list.

### 1.3 Reconciliation with the strategy's original P2 (DS0–DS8), D2 and ADR-042

The strategy's P2 assumed **per-tenant full palettes**: venue brand colours mapped onto every semantic token, a `tenant_theme` table,
and an inline `<style>` per layout. The founder's 2026-11-14 decision replaces that with **one system plus a three-setting venue layer**.

| Old step | Fate | Why / where it went |
|---|---|---|
| DS0 ADR "Per-tenant theming" | **Changed** → ADR-045 (P2a-1) | Same need (a decision record with CSP impact and rejected alternatives), new content: one system, a venue layer, and band-only custom properties under ADR-028's existing `style-src 'unsafe-inline'` (ADR-028 `:45`, `:116-117`). The header is unchanged |
| DS1 `TenantPalette`, `themeFromPalette`, osteria mapping (§6.3, D2), tab labels to `type-label`, `--spacing-tap` WCAG comment | **Dropped**, except two survivors: tab labels at 15 px (P2a-10) and the `--spacing-tap` comment with its ≥ 2.75rem test (P2a-11) | A venue no longer maps a palette onto tokens; the Costì values are fixed (`PRODUCT_THEMES`) |
| DS2 `checkTheme()` | **Changed** → `venueLayer()` refusals (P2a-2) | The full-theme gate already exists: every `CONTRAST_PAIRS` entry runs on `PRODUCT_THEMES` in both themes (`tests/lib/design/tokens.test.ts:256-274`). The only variable input left is the accent, which has two rules |
| DS3 status tokens not themable | **Survives by construction** (P2a-2 test) | The layer can set only `band` and `band-ink` |
| DS4 `tenant_theme` table, RLS, `PUT /api/settings/theme` | **Dropped from P2** → SP9 | Lead scope limit. The contract SP9 produces is in §4.2 |
| DS5 an inline `<style>` in the layouts | **Changed** → two custom properties on the band element (P2a-3) | One element, two declarations, hex values from `venueLayer()` only. The "only `--color-*` hex" serialiser test survives as the `HeaderBand` style test |
| DS6 tenant name in the band | **Done earlier** (QW13/CB `venue.name`). **Changed:** the name now has one source, the venue object (P2a-3) | SP9 swaps that source for `/api/me` (platform plan `:597`) |
| DS7 `StateView` | **Out of P2** (not in `costi-design-system.md` §10.3) | Q-L7: stays a P4 item |
| DS8 per-device light/dark override | **Out of P2** (not in the spec) | Q-L7 |

**D2 ("brand colours only": the osteria's eight colours and two fonts) is superseded** by `costi-design-system.md` §1.
- The osteria palette (`BRAND`, `DERIVED`, `THEMES`) and the fonts Bodoni Moda and Figtree retire in P2j.
- The only osteria colour that survives is the approved green `#1C4130`, as the venue accent.
- ui-foundation's osteria theme (§1–§2) becomes history in the docs step (P2j-3).

**ADR-042 stays accepted for its mechanism.** ADR-045 records that two of its decisions are superseded:
- decision 2 (only the product surfaces render the scope): the scope spreads one group at a time, then disappears in P2j;
- decision 3 (a tenant theme is a full `COLOR_TOKENS` value set): a tenant sets two tokens through `venueLayer()`.

ADR-042's status line keeps its leading word "accepted", because `tests/config/costi-brand-docs.test.ts:49` matches
`^- \*\*Status:\*\* accepted`.

## 2. Current state (verified on ee092e6)

### 2.1 Tokens and CSS

`src/app/globals.css`:
- `@theme` holds the osteria light values and `--spacing-tap` / `--spacing-tap-comfort` (`:12-59`).
- `@theme inline` font stacks name "Figtree" and "Bodoni Moda" literally (`:65-69`).
- Osteria dark block: `:75-104`.
- Costì light block `:root:has([data-brand="costi"])`: `:106-143`. It also remaps the four font variables (`:139-142`).
- Costì dark block: `:145-175`.
- Other rules:
  - the `.band` grain (`:217-233`);
  - reduced motion (`:281-289`);
  - the sticky-bar scroll padding (`:292-294`);
  - K-b (`:297-300`);
  - high contrast (`:331-351`).

`src/lib/design/tokens.ts`:
- `COLOR_TOKENS` (25 names): `:8-34`.
- Osteria: `BRAND` `:44-53`, `DERIVED` `:73-77`, `THEMES` `:79-134`.
- Costì: `PRODUCT_BRAND` `:140-146`, `PRODUCT_DERIVED` `:163-175`, `PRODUCT_THEMES` `:182-237`.
- Pair lists: `CONTRAST_PAIRS` `:251-283`, `ACCENT_ONLY` `:286`, `HIGH_CONTRAST_PAIRS` `:296-306`.

`src/lib/design/contrast.ts`: `parseHex` throws `TypeError` on anything but `#RRGGBB` (`:7-12`); `contrastRatio` is at `:26-30`.

### 2.2 Scope, band and brand

- **`src/components/product-scope.tsx`:** `ProductLogo` (`:12-22`). `ProductScope` (`:24-31`) is a `display: contents` wrapper with
  `data-brand="costi"` around the logo and the children.
- **The product layouts** `(public)/login/layout.tsx` and `(public)/dispositivo/layout.tsx` render `ProductScope` and export
  `viewport.themeColor = PRODUCT_THEMES.light.band` (`:8`, `:11`).
- **`src/components/header-band.tsx:8-17`:** `<header className="band border-b-2 border-gold">`, with no colour input.
- **`src/components/brand.tsx`:**
  - `BrandMark`, the gold lozenge (`:12-24`);
  - `BRAND_LINK_CLASS` (`:27-28`), `BrandLink` (`:34-40`), `BrandTitle` (`:46-52`), `ProductBrandLink` (`:58-66`);
  - `BrandWordmark`, which renders the mark and `t("venue.name")` (`:68-77`);
  - `RecommendedBadge` (`:84-91`), with **no consumer in `src/`**: only `tests/components/file-picker.test.ts:67` renders it.
- **Where the band is rendered:**
  - signed-in pages: `src/app/(owner)/app-shell.tsx:65-68`;
  - public pages: `(public)/layout.tsx:10`, with `PublicBrand` (`public-brand.tsx:8-10`);
  - the root `viewport.themeColor` uses `THEMES.light.band` and `THEMES.dark.band` (`src/app/layout.tsx:101-109`).
- **`t("venue.name")`** is used at:
  - `brand.tsx:73`;
  - `(owner)/page.tsx:91, :99`;
  - `(public)/prenota/[slug]/page.tsx:7`;
  - `(public)/prenota/[slug]/annulla/page.tsx:8`.

### 2.3 Fonts

`src/app/layout.tsx`:
- Bodoni Moda 600 and Figtree 400/700 are preloaded, with latin-ext twins that are not (`:17-66`).
- Montserrat 600 and Inter 400/700 have `preload: false` (`:72-88`).
- All six font variables are on `<html>` (`:121`).

### 2.4 Components the spec touches

- **`src/components/ui.tsx`:**
  - `NOTE` (`:168-169`); `warningNoteClass` and `dangerNoteClass` (`:172-175`);
  - `Heading` (`:195-206`), `SubHeading` (`:208-217`);
  - `Card` (`:220-229`);
  - `Badge`, with five tones and `data-tone` (`:244-276`).
- **`src/components/nav/nav-classes.ts:13-16`:** `tabClass` is `text-sm`.
- **`src/app/(owner)/tracciabilita/trace-parts.tsx:16-29`:** local copies of InfoNotice (`infoNoteClass`) and FactRow
  (`FACT_LIST_CLASS`, `Fact`).
- **The login card's Coral edge** is hand-written (`(public)/login/login-screen.tsx:59-61`).
- **Hand-made tablists:**
  - `tavoli/comanda/course-tabs.tsx:21-41`;
  - the comanda view tabs (`comanda/page.tsx:450-469`, `bg-accent`);
  - `tracciabilita/page.tsx:57-72`;
  - `(public)/prenota/[slug]/slot-picker.tsx:43-53` (services). The time buttons there are an `aria-pressed` group, not tabs.
- **Sala type literals:**
  - `comanda/bill-sheet.tsx:80`, the total: `font-display text-3xl`;
  - `close-sheet.tsx:99` and `split-panel.tsx:64`: `h3 font-display text-xl`;
  - `open-table-dialog.tsx:47-51`: h2 `font-display text-[1.5rem]`.
- **The rest of the app:** a grep of `src/app` for `<dl|font-display|after:bg-gold|bg-gold` finds 42 files (the per-slice lists are in §5).
  No screen hard-codes a colour, so the re-skin needs **no colour edits in screens**: type and structure only.

### 2.5 Sala today (for Direct comanda)

**`/tavoli` (`tavoli/page.tsx`)**
- A tap selects a tile (`:87-90`):
  - an open table → `SessionPanel` (`:158-171`);
  - a free or closed table → `OpenTableDialog`, a card above the grid (`:172-180`).
- `openTable` queues `open_table` and goes to the comanda; offline it uses `window.location.assign` (`:92-107`).
- `updateSession` is `PATCH /api/table-sessions/:id` followed by one `/api/tables` read (`:109-116`).
- The `/api/tables` poll runs every 15 s and pauses while the page is hidden (`:70-85`).

**`tavoli/session-panel.tsx`**
- Card `role="group"` named after the table (`:53`).
- Covers, opener and coperto lines (`:57-63`).
- "Prendi la comanda" link (`:64-66`); "Conto e chiusura" link (`:67-69`).
- "Modifica coperti" with `CoversField` (`:70-101`).
- "Conto richiesto": a pressed secondary with ✓ (`:102-116`).
- Offline: `tables.panel.needsConnection` (`:117`).
- `ErrorAlert` (`:118`); "Chiudi" (`:119-121`).

**`tavoli/table-tile.tsx:34-52`:** every tile that is not joined is a `<button>` that calls `onSelect`.

**`tavoli/open-table-dialog.tsx:16-67`:**
- a `Card role="group"` holding a form: h2 "Apri {name}", `CoversField` (a stepper with `tables.covers.less` / `.more`), primary
  "Apri tavolo", quiet "Annulla";
- the session id is made once (`:31`).

**Comanda (`comanda/page.tsx`)**
- "← Tavoli" `GuardedLink` (`:402-406`); h1 (`:443`); covers and status badge (`:444-447`); view tabs (`:450-469`).
- Order tab: `CourseTabs`, pinned strip, menu (`:563-583`), then `OrderSheet` (`:601-633`), with `expanded` state (`:78`).
- `sendLines` (`:300-310`); the QW12 leave guard (`:220-240`, `:587-600`).
- Polls: `/api/menu` and `/lines` every `ORDER_REFRESH_MS`, paused while hidden (`:149-165`), plus one read when the outbox shrinks
  (`:208-218`).

**`comanda/order-sheet.tsx`**
- The lines card is shown only when `expanded` (`:71-110`).
- Per-course `SendButtons`: their first button is **primary** (`send-buttons.tsx:32`).
- The bar holds the summary toggle (`aria-expanded`, `:112-120`) and the `barSend` primary (`:121-133`).
- After a send, focus is restored (`:60-68`).

### 2.6 APIs Direct comanda uses (read-only check)

| Need (`p3-sala-waiter.md` §10) | Already there? |
|---|---|
| Header h1, status badge (including "Conto richiesto", the `bill_requested` status word), covers, closed | **Yes.** `GET /api/table-sessions/:id/lines` → `orderSession` = `id, tableId, tableName, covers, status, billRequested, closed` (`src/server/orders/output.ts:37-45`) |
| "Modifica coperti" and the "Conto richiesto" toggle | **Yes.** `PATCH /api/table-sessions/:id`; roles owner, admin, waiter; body `sessionPatchBody` (`src/app/api/table-sessions/[id]/route.ts:6-15`). It is the call the panel makes today |
| Tile → comanda, offline as well | **Yes.** `comandaHref(session.id)`, the static page cached by the service worker (M20). `pwa.spec.ts:143-159` proves a tap reaches it on a dead network |
| "Conto" tab: bill, split, close | **Yes** (`comanda/page.tsx:475-559`) |
| Sent lines folded per course | **Yes.** Lines carry `state` and `course`; the folding is presentation only |
| §10.2 meta line: "Giulia alle 20:14 · Coperto 4 × 2,50 €" (`openedLine`, `copertoLine`) | **No.** The opener (`waiter.displayName`, `openedAt`, `openedToday`) and `coperto` exist only on `/api/tables`' `tileSession`, not on `orderSession` (a `strictObject`). → **DS-BQ-2** gates P2b-10. Until then the meta line shows `coversLine` only. There is no placeholder text and no extra `/api/tables` read (D17) |
| W2 tile count | **No.** It needs `unsentCount` (P3 BQ-1) → gates P2b-9 |

### 2.7 Guards a token or theme change can turn red (from a grep of `tests/` and `e2e/`)

**Inside this builder's paths** (each one changes in the step that needs it; see §5c):
- `tests/lib/design/tokens.test.ts:119-150`, `:190-254` and `:256-359`.
- `tests/lib/design/fonts.test.ts:8-19`, `:66-79`, `:102`, `:116-132` and `:150-164`.
- `tests/lib/design/{motion,sala-contrast,sticky-bar-css,tap-comfort}.test.ts`: these stay green (P2 moves none of their rules).
- `tests/components/product-scope.test.ts`: lines `:17-31`, `:57-72`, `:87-94`, `:96-107`.
- Brand and badge tests: `brand-link.test.ts:17`, `brand-title.test.ts:18`, `public-brand.test.ts:41`, `file-picker.test.ts:67-`,
  `course-tabs.test.ts`.
- e2e:
  - `product-brand.spec.ts:97-139`;
  - `app-shell.spec.ts:49-55`;
  - `password-login.spec.ts:92`;
  - `reservations-public.spec.ts:261`;
  - `fonts.spec.ts:32-37` and `:86-115`.

**Outside this builder's paths:**

| Guard | Effect of P2 | Result |
|---|---|---|
| `tests/design/kitchen-contrast.test.ts:4, :19` | Checks `HIGH_CONTRAST_PAIRS` on `THEMES`, which P2j-1 deletes | **Red at P2j-1 → DS-BQ-1** (two lines) |
| `tests/config/costi-brand-docs.test.ts` | Imports `PRODUCT_THEMES` (kept); ADR-042 text and status prefix kept; ui-foundation §11 table equals `PRODUCT_THEMES` (values unchanged) | Green, if P2j-3 edits only the prose of §11 |
| `tests/config/ux-quick-wins-preserves.test.ts:23-33` | The same 25 colour names in `@theme`; the spacing list is unchanged; the type ramp uses arbitrary classes | Green |
| `tests/config/no-venue-literal.test.ts` | The venue object reads `t("venue.name")` | Green |
| `tests/config/m25b-docs.test.ts`, `no-new-deps.test.ts`, `costi-brand-assets.test.ts` | Untouched | Green |
| `tests/app/manifest.test.ts:23-27` (in neither list) | `PRODUCT_THEMES` is kept | Green |
| `tests/guards/public-page-csp.test.ts:24` (in neither list) | `style=` stays out of `prenota/**` sources; the band's style attribute is in `src/components/header-band.tsx` | Green. The rendered attribute is allowed by ADR-028's `style-src 'unsafe-inline'` (recorded in ADR-045) |
| `e2e/security-headers.spec.ts` | CSP header unchanged | Green |

## 3. Decisions (with alternatives rejected)

| # | Decision | Why | Rejected |
|---|---|---|---|
| D1 | **ADR-045** "One Costì design system; the venue is a layer" (P2a-1). It supersedes ADR-042 decisions 2–3, replaces DS0's proposed ADR, and records the CSP impact: the header is unchanged, and the band's custom properties rely on ADR-028's `style-src 'unsafe-inline'` | The decision outlives the task: it fixes what SP9 may store and how it is served | No ADR: ADR-042 would then state a contract the code no longer follows |
| D2 | **The venue layer re-values `--color-band` and `--color-band-ink` as two custom properties on `<header>`.** The values come only from `venueLayer()`. The Coral rule (`border-gold`) and every other token stay Costì | Ready for SP9 at runtime with no CSS change; limited to the band; no new token name; the "no colour outside the blocks" guard stays exact | (a) A `globals.css` block per venue: one deploy per tenant. (b) An inline `<style>` per layout (the old DS5): page-wide. (c) A `/theme.css` route: an extra request and a cache question, for two values |
| D3 | **One band source from P2a-3.** The venue layer applies on every venue band (the signed-in shell and the guest band), including screens not yet re-skinned. Product pages get no layer and stay Forest | One code path (rule B). The visible change on not-yet-re-skinned pages is small: in light the band stays `#1C4130` and band-ink goes from cream to Off-white; in dark the band goes from `#16301F` to `#1C4130`. The osteria gold on `#1C4130` is the tested 4.26 pair | A band per slice (variant V1) |
| D4 | **`CostiTheme` is a marker, not a wrapper:** `<span data-brand="costi" hidden />`, rendered by the group's `layout.tsx` (by `page.tsx` for Home). `ProductScope` is deleted | `:has()` matches hidden elements. The children stay direct children of `main`, so the `.reveal` stagger keeps working; a `contents` wrapper would take the rise away | Keeping the wrapper |
| D5 | **A shrinking order guard**, `tests/components/costi-theme-order.test.ts`, with `RESKIN` steps and `DONE = n`. For steps up to `DONE`, every root renders `CostiTheme`, and no file in them has `<dl` (use `FactList`), `role="tablist"` (use `SegmentedControl`) or `font-display` (use `Heading`/`SubHeading`; allow-list in §4.4). Later steps' roots do not mention `CostiTheme` | Keeps the two-theme period explicit and finite | A docs checklist |
| D6 | **The contract and the osteria constant live in `src/lib/design/venue-layer.ts`**, not in `tokens.ts` as `costi-design-system.md` §9 says | `tokens.ts` holds only the values mirrored by CSS and must not import i18n | Q-L9 asks the designer to update the spec |
| D7 | **`venueLayer(accent)` follows `costi-design-system.md` §9:**<br>• band-ink is Off-white or Charcoal, whichever contrasts more (a tie gives Off-white);<br>• `band_ink_contrast` if under 4.5, otherwise `rule_contrast` if Coral (`PRODUCT_THEMES.light.gold`) on the accent is under 3;<br>• a malformed hex throws `parseHex`'s `TypeError`;<br>• `requireVenueBand(venue)` throws `VenueLayerRefused`.<br>**No fallback colour** | Lead decision | Clamping or darkening the accent: that is a silent fallback |
| D8 | **Each new component replaces an existing path in the same commit** (P2a-5..9). Hand-written `<dl>` and tablists in screens move in their group's slice, enforced by D5 | Rule B | Converting every screen in P2a, against the slicing |
| D9 | **`BrandMark` is deleted.** With `logo: null` the band shows the name. With a logo, an `<img>` 28 px high (`h-7`), `alt` = name, replaces the name | `costi-design-system.md` §9, §10.3 | Keeping the placeholder |
| D10 | **The re-skin keeps every component class name** (`bg-accent`, `bg-ink`, …) | The ~25 "exactly one `bg-accent`" component tests stay valid | Product-specific classes |
| D11 | **The fonts stay until P2j-2.** Then Bodoni, Figtree and their latin-ext twins are deleted and Montserrat and Inter are preloaded. The product files are full-charset | No double preload during the transition | Preloading both sets |
| D12 | **Direct comanda, the tile (§10.1):**<br>• an open tile (status `open` or `bill_requested`, with a session) is a `next/link` to `comandaHref(session.id)`, keeping `data-table-id` and `data-contrast-box`;<br>• free and closed tiles stay buttons that open the free-table sheet (D16);<br>• joined tiles are unchanged.<br>**Return to the grid with its scroll position:** a tap on a tile saves `window.scrollY` in `sessionStorage["tavoli.scroll"]` (a number, no personal data), and `/tavoli` restores it once after its first list render, then clears it | Navigation is a link. Offline, the link behaves as today's "Prendi la comanda" link, which `pwa.spec.ts:143-159` covers. "← Tavoli" is a new navigation, which would otherwise land at the top | `router.push` from a button; the history API's own restoration (it does not apply to a pushed link) |
| D13 | **Direct comanda, lines first (§10.2):**<br>• the order card (h2 "Comanda", `tabIndex={-1}`) renders **above** the course tabs, open on arrival;<br>• drafts are listed in full;<br>• the per-course `SendButtons` become **secondary**, so the bar's "Invia …" is the one primary;<br>• with no lines the card shows `orders.lines.emptyHint` "Nessun piatto ancora: scegli dal menu qui sotto." (da approvare);<br>• **the bar's summary button keeps its text and position**, loses `aria-expanded`, and on tap scrolls the card into view and focuses the h2;<br>• after a send that unmounts the primary, focus goes to the summary as today (P3 D8) | `p3-sala-waiter.md` §10.2 | Removing the summary button (it is the thumb-reach way back to the lines) |
| D14 | **Direct comanda, sent lines fold (§10.2):** for each course with sent lines (fired or voided), one row button "Primi · 3 inviati" (`orders.sent.folded`, da approvare; the "▸" is `aria-hidden`) with `aria-expanded` unfolds those lines in place, with "Storna" as today; voided lines stay struck through inside. The state is local per course, folded by default on each mount. Pure helper `foldSent(lines)` in `src/lib/orders/order-view.ts` | §10.2 "long comande stay short"; the counting rule lives in a tested pure helper, not in the component | Folding inside `OrderSheet`'s render logic |
| D15 | **Direct comanda, header and panel actions (§10.3, lead change):**<br>• row 1: h1 and the **"Tavolo ▾"** secondary disclosure (accessible name "Tavolo: altre azioni", `tables.more.label`, da approvare; `aria-expanded`; 44 px);<br>• row 2: the status badge (it already reads "Conto richiesto" when requested) and the **"Conto richiesto" pressed-secondary toggle** (`aria-pressed`, `data-on`, `aria-hidden` ✓, never primary: QW11);<br>• row 3: the meta line;<br>• the disclosure opens a card in place, under the header, with "Modifica coperti" (stepper, "Salva coperti", "Annulla") and its `ErrorAlert`;<br>• offline, both controls are disabled and `tables.panel.needsConnection` shows once under row 2;<br>• a toggle error is an `ErrorAlert` under row 2;<br>• each write is the existing PATCH followed by **one** `loadView()`;<br>• on a closed session the toggle and the disclosure are not rendered;<br>• "Conto e chiusura" is the "Conto" view tab; "Chiudi" is "← Tavoli" | §10.3 with the lead's change. No separate "Conto richiesto" badge: with the toggle in the header and the status badge already saying it, a third mark would only repeat the state | The toggle inside "Tavolo ▾" (§10.3 as first written; changed by the lead) |
| D16 | **Free table, bottom sheet (§10.1).** `OpenTableDialog` renders as a bottom sheet in the leave-sheet pattern (`leave-sheet.tsx`: fixed bottom, `bg-ink/40` scrim, `z-30`):<br>• `role="dialog"`, `aria-modal="true"`, `aria-labelledby` the h2 "Apri {name}";<br>• focus goes to the h2 on open; Esc, the scrim and "Annulla" close it and return focus to the tile;<br>• the stepper, "Apri tavolo" and the queued open are unchanged | §10.1 | A new shared `BottomSheet` component: a refactor of three sheets, outside this slice |
| D17 | **Meta line (§10.2) waits for DS-BQ-2.** P2b-4 shows `coversLine(covers)`; P2b-10 adds `openedLine` and `copertoLine` once `orderSession` carries them | Screens read `/api/*` with no data logic, and a second read of `/api/tables` from the comanda would duplicate the grid's payload. No placeholder (rule B) | Reading `/api/tables` once in the comanda; a stale value carried in the URL or `sessionStorage` from the tile |
| D18 | **Type in Sala:**<br>• sheet `h3` → `costi/label` (`text-base font-bold`);<br>• bill total → `.num font-bold text-3xl` (Inter);<br>• the free-table sheet heading → `SubHeading` | `costi-design-system.md` §3 | Montserrat at 20 px (V2) |

**Founder standing rules**

- **Rule A.** No new polling. The `/tavoli` and comanda polls are unchanged. Header writes read once after their own PATCH, as the panel
  did. The scroll restore is one read of `sessionStorage`. W2 rides the existing `/api/tables` poll.
- **Rule B.** Each step replaces; nothing is left behind:
  - P2a deletes `ProductScope`, `course-tabs.tsx`, `RecommendedBadge`, `BrandMark` and the `trace-parts` copies;
  - P2b deletes `SessionPanel`, the summary's `aria-expanded` toggle, `orders.open`, `tables.panel.billLink` and `tables.panel.hide`;
  - P2j deletes `THEMES`, `BRAND`, `DERIVED`, the osteria blocks, the `:has()` blocks, `CostiTheme` and the old fonts.
- **No compat aliases, no fallback colour, no placeholder count or meta text.**

## 4. Design

### 4.1 Token map: Figma → CSS variable → Tailwind (`costi-design-system.md` §10.1–§10.2)

The values are `PRODUCT_THEMES` (`tokens.ts:182-237`; ui-foundation §11, pinned by tests). The names are the existing `COLOR_TOKENS`:
none is added or renamed.

| Figma variable | CSS variable | Tailwind utilities in use | Venue layer |
|---|---|---|---|
| `color/paper` | `--color-paper` | `bg-paper`, `text-paper` | — |
| `color/surface` | `--color-surface` | `bg-surface`, `text-surface` | — |
| `color/sunk` | `--color-sunk` | `bg-sunk`, `hover:bg-sunk`, `data-[on=true]:bg-sunk` | — |
| `color/ink` | `--color-ink` | `text-ink`, `bg-ink`, `border-ink`, `bg-ink/40` | — |
| `color/ink-muted` | `--color-ink-muted` | `text-ink-muted`, `bg-ink-muted` | — |
| `color/rule` | `--color-rule` | `border-rule` | — |
| `color/rule-strong` | `--color-rule-strong` | `border-rule-strong` | — |
| `color/band` | `--color-band` | `.band` | **set by `venueLayer().band`** |
| `color/band-ink` | `--color-band-ink` | `text-band-ink`, `focus-visible:outline-band-ink` | **set by `venueLayer().bandInk`** |
| `color/gold` (Coral) | `--color-gold` | `border-gold`, `after:bg-gold`, `bg-gold` | — (checked against the band) |
| `color/highlight`, `color/on-highlight` | `--color-highlight`, `--color-on-highlight` | `bg-highlight text-on-highlight` | — |
| `color/accent`, `color/accent-hover`, `color/on-accent` | `--color-accent…` | `bg-accent text-on-accent hover:bg-accent-hover`, `accent-accent` | — |
| `color/accent-ink` | `--color-accent-ink` | `text-accent-ink` | — |
| `color/focus` | `--color-focus` | `:focus-visible` outline, `outline-focus` | — |
| `color/{success,warning,danger,info}` and `-bg` | `--color-…` | `text-*`, `bg-*-bg`, `border-*` | — |

| Figma size, type or effect | Code |
|---|---|
| `size/tap` 44 · tap-comfort 52 | `--spacing-tap` (`min-h-tap`) · `--spacing-tap-comfort` (`min-h-tap-comfort`, `Button comfort`) |
| `space/gutter` 16 · `field-gap` 16 · `rhythm` 24 · `inline` 8 · `label-gap` 6 | `px-4` · `gap-4` · `gap-6` · `gap-2` · `gap-1.5` |
| `radius/control` 8 · `radius/card` 12 · `radius/full` | `rounded-lg` · `rounded-card` · `rounded-full` |
| `size/column` 448 | `max-w-md` |
| `stroke/focus` 3 | `globals.css:195-198` |
| `costi/display` 40 | the sign-in h1 classes |
| `costi/title` 34/37 | `Heading` |
| `costi/section` 24/30 | `SubHeading` |
| `costi/wordmark` 21, caps, +0.1em | the `BrandWordmark` and `ProductBrandLink` classes |
| `costi/body` 16/24 | `font-sans text-base` |
| `costi/label` 16/22 · `costi/label-sm` 15/20 | `font-bold text-base` · `font-bold text-[0.9375rem]` |
| `costi/meta` 14/20 | `text-sm text-ink-muted` |
| `costi/num` | `.num` |
| `elevation/card` | `Card` shadow |
| Fonts | `--font-display` → Montserrat 600; `--font-sans` → Inter (root stacks from P2j-2) |

### 4.2 The venue layer contract (what SP9 must produce)

`src/lib/design/venue-layer.ts` is client-safe and pure:

```ts
export type Hex = `#${string}`;                       // validated #RRGGBB, uppercase
export interface VenueLogo { src: string }            // same-origin path "/…" (Q-L10)
/** Exactly what a tenant may set (costi-design-system.md §9). SP9 produces this from the tenant record. */
export interface Venue { name: string; logo: VenueLogo | null; accent: Hex }
export const venueSchema: z.ZodType<Venue>;           // name trimmed 1–40; logo null | { src: /^\/(?!\/)/ }; accent /^#[0-9A-Fa-f]{6}$/ → uppercase
export type VenueRefusal = "band_ink_contrast" | "rule_contrast";
export type VenueBand =
  | { ok: true; band: Hex; bandInk: Hex; bandInkRatio: number; ruleRatio: number }
  | { ok: false; refusal: VenueRefusal; ratio: number };
export function venueLayer(accent: Hex): VenueBand;   // D7
export class VenueLayerRefused extends Error { refusal: VenueRefusal; ratio: number }
export function requireVenueBand(venue: Venue): { band: Hex; bandInk: Hex }; // throws, never falls back
export const VENUE_LAYER_DEFAULT: Venue = { name: t("venue.name"), logo: null, accent: "#1C4130" };
```

**What SP9 must do:**
- store `name`, `logo` and `accent`;
- validate with `venueSchema` and `venueLayer()` when saving, and refuse with the refusal code;
- serve the `Venue` (through `/api/me`, per the platform plan).

The shell then swaps its import of `VENUE_LAYER_DEFAULT` for that value; no other component changes.

**Numbers:**
- The osteria (from `costi-design-system.md` §9): band-ink **10.67:1**, Coral rule **4.43:1**.
- Refusal fixtures. These were hand-computed with `contrast.ts`'s formula; the test is the authority:

| Accent | Ratios | Refusal |
|---|---|---|
| `#808080` | Off-white ≈ 3.71, Charcoal ≈ 3.74 | `band_ink_contrast` |
| `#555555` | Off-white ≈ 7.0, Coral ≈ 2.91 | `rule_contrast` |
| `#FFFFFF` | Charcoal chosen (≈ 14.7), Coral ≈ 2.56 | `rule_contrast` |

**A consequence of the two rules (hand-computed).** Coral reaches 3:1 only on a band of luminance ≤ ≈ 0.086, where Charcoal can never
reach 4.5. So every accepted accent gets Off-white band-ink (Q-L11).

**Security:**
- Only two hex values ever reach a `style` attribute, and only on `<header>`.
- The name is rendered as text.
- The logo `src` is a same-origin path (schema test): it stays inside `img-src 'self'`, and protocol-relative and `javascript:` values
  are refused.

### 4.3 Component inventory, old → new

| Figma | Before | After | Step |
|---|---|---|---|
| HeaderBand · product | `HeaderBand` + `ProductBrandLink` | unchanged (no `venue`) | — |
| HeaderBand · venue | `HeaderBand` + `BrandWordmark` (`BrandMark` + name) | `HeaderBand venue` sets two variables; `BrandWordmark venue` shows the logo **or** the name; `BrandMark` deleted | P2a-3 |
| ProductLogo | inside `product-scope.tsx` | `src/components/product-logo.tsx` | P2a-4 |
| — | `ProductScope` | the `CostiTheme` marker | P2a-4 |
| Badge (6 tones) | 5 tones + `RecommendedBadge` | `Badge tone="highlight"`; `RecommendedBadge` deleted | P2a-5 |
| Card (Coral edge) | a hand-written span in login | `Card edge` | P2a-6 |
| InfoNotice | `trace-parts` `infoNoteClass` | `InfoNotice` (`ui.tsx`, `role="status"`) | P2a-7 |
| FactRow | `trace-parts` `Fact` / `FACT_LIST_CLASS`, page `dl`s | `FactList` + `FactRow` (`src/components/fact-list.tsx`) | P2a-8, then per slice |
| Tabs (segmented) | `course-tabs.tsx`, the comanda view tabs, the trace tabs, the slot-picker services | `SegmentedControl` (`src/components/segmented-control.tsx`): ink fill when selected, optional `comfort`, optional count | P2a-9, P2b-3, P2f-2, P2i-2 |
| BottomTabs | 14 px labels | 15 px labels | P2a-10 |
| DayPicker | `chiusura/day-picker.tsx` | `src/components/day-picker.tsx` | P2g-3 (V6) |
| LedgerRow (new props) | — | **not built** (no step needs them) | — (Q-L7) |
| Session panel | `tavoli/session-panel.tsx` | deleted; its actions go to the comanda header and "Tavolo ▾" (`comanda/table-header.tsx`) | P2b-4, P2b-7 |
| Open-table card | `open-table-dialog.tsx` (a card) | the same file as a bottom sheet | P2b-8 |

### 4.4 Re-skin order (`costi-design-system.md` §11) and route mapping

| Slice · step | Route roots under `src/app/(owner)/` (or as named) | Notes |
|---|---|---|
| P2b · 1 Sala | `tavoli/**` | + Direct comanda, W-a+, W2 (gated) |
| P2c · 2 Cucina | `cucina`, `produzione`, `riordino`, `margini` | high-contrast pairs on Costì (pinned in P2a-11) |
| P2d · 3 Home | Home `page.tsx`, `spingere`, **`altro`, `avvisi`** | the bold roots are not in §11 (Q-L3) |
| P2e · 4 Fatture | `fatture`, **`pagamenti`** | Q-L3 |
| P2f · 5 Magazzino | `magazzino`, `tracciabilita` | |
| P2g · 6 | `chiusura`, `prenotazioni`, `report` | |
| P2h · 7 | `ricette`, `costi`, `anagrafiche`, `personale`, `registro`, `impostazioni`, **`menu`, `dispositivi`, `doppia-verifica`, `password`, `sicurezza`** | Q-L3 |
| P2i · 8 | `src/app/(public)/prenota/**` | guest e-mails: `render.ts` has no colour or font, so nothing to re-skin |
| P2j · 9 | `:root`; `not-found.tsx` (`global-error.tsx` uses the system font and is untouched) | |

**`font-display` allow-list** in the D5 guard:
- `src/components/ui.tsx`;
- `src/components/brand.tsx`;
- `(public)/login/login-screen.tsx` (the display h1);
- `(owner)/cucina/ticket-card.tsx` (the 28 px ticket name; Q-L4).

### 4.5 Sequence: a signed-in Sala page after P2b

1. `RootLayout` renders `<html>` with the six font variables. `viewport.themeColor` is `requireVenueBand(VENUE_LAYER_DEFAULT).band`.
2. `AppShellView` renders `HeaderBand venue={VENUE_LAYER_DEFAULT}`:
   `<header class="band border-b-2 border-gold" style="--color-band:#1C4130;--color-band-ink:#F7F8F6">`.
3. `tavoli/layout.tsx` renders `<CostiTheme />` and the page. `:root:has([data-brand="costi"])` re-values every token to Costì; the band
   keeps its two variables.
4. A client navigation to a group not yet re-skinned unmounts the marker, and the osteria values return everywhere except the band (D3).

### 4.6 Direct comanda (P2b-4..10), from `p3-sala-waiter.md` §10

```
/tavoli tile, occupied  ──link (save scrollY)──▶ /tavoli/comanda?s=<id>
/tavoli tile, free      ──button──▶ bottom sheet "Apri {name}" · stepper · [Apri tavolo] · Annulla ──queued open──▶ comanda
comanda:
  ‹ Tavoli
  Tavolo 2                                   [Tavolo ▾]      h1 + disclosure (aria-expanded) → card: Modifica coperti
  [Aperto]  [✓ Conto richiesto]                              status badge + pressed-secondary toggle (lead decision)
  4 coperti · Giulia alle 20:14 · Coperto 4 × 2,50 €         meta (opener and coperto after DS-BQ-2, P2b-10)
  [ Comanda | Conto ]                                        SegmentedControl, ink fill
  ┌ Comanda (h2) ───────────────────────┐
  │ drafts in full, per-course Invia (secondary)
  │ Primi · 3 inviati  (aria-expanded)   ▸ unfolds sent/voided lines with Storna
  └─────────────────────────────────────┘
  [course tabs] · pinned · menu
  sticky bar: [Comanda · 5 righe] (scrolls to and focuses h2)   [Invia antipasti · 2] (one primary)
back "‹ Tavoli" → /tavoli, scroll restored once
```

### 4.7 Data model and API

There is no change in this builder's work. DS-BQ-2 (`orderSession` fields) and P3's BQ-1 (`unsentCount`) belong to the platform builder
(§9).

## 5. Build plan (one commit per step, test first)

- **Test first.** Each step's failing-first test is written first and seen failing for the reason given. A **guard** already passes and
  must stay green.
- **e2e.** Runs in the 360 × 740 phone projects (and `laptop` where named). Specs that need the stack run first in CI.
- **Before every commit:** `npx tsc --noEmit`, `npm run lint`, `npm test`.
- **Order.** One PR per slice, P2a → P2j, each cut from `main` after the previous one merged.

### P2a · Tokens, venue layer, core components (first PR, 11 commits)

| # | Step | Files | Failing-first test (why it fails on ee092e6) | Guards and e2e |
|---|---|---|---|---|
| P2a-1 | **ADR-045** (doc step). Sections: Context; Decision (D2, D3, D4, D7, the `Venue` contract, CSP: ADR-028 `:45`/`:116-117`, header unchanged); Alternatives (D2 a–c, ADR-042's full-value-set contract); Consequences. ADR-042's status line becomes "accepted; decisions 2 and 3 superseded by ADR-045 (2026-11-14)" | `docs/adr/adr-045-one-design-system-venue-layer.md`, `docs/adr/adr-042-product-theme-scope.md` (status line only); E-1 | `tests/lib/design/design-system-docs.test.ts` (new):<br>• ADR-045 has the title, "accepted" and the four sections;<br>• Decision names `venueLayer`, `band_ink_contrast`, `rule_contrast`, `--color-band`, `style-src`, `ADR-028`;<br>• Alternatives names `tenant_theme` and "rejected";<br>• ADR-042's status line starts with "accepted" and contains "ADR-045".<br>Fails because the file does not exist | `costi-brand-docs.test.ts:47-73` green |
| P2a-2 | **Venue layer** (§4.2) | `src/lib/design/venue-layer.ts` (new), `tests/lib/design/venue-layer.test.ts` (new) | Fails: no module.<br>(a) `#1C4130` → ok, `#1C4130` / `#F7F8F6`, ratios "10.67" and "4.43".<br>(b) `#808080` → `band_ink_contrast`, `ratio < 4.5`.<br>(c) `#555555` → `rule_contrast`, `ratio < 3`.<br>(d) `#FFFFFF` → `rule_contrast`.<br>(e) A malformed hex throws `TypeError`.<br>(f) `requireVenueBand` with `#555555` throws `VenueLayerRefused` and never returns a colour.<br>(g) An ok result has exactly the keys `ok, band, bandInk, bandInkRatio, ruleRatio`.<br>(h) `venueSchema` refuses `""`, 41 characters, `//x.test/a.svg`, `https://…`, `javascript:…` and `#12345`; it uppercases `#1c4130`.<br>(i) `VENUE_LAYER_DEFAULT` parses; its name is `t("venue.name")`, `logo` is null, the accent is `#1C4130`, and `docs/client-facts.md` contains `#1C4130` | `no-venue-literal.test.ts` green |
| P2a-3 | **The band wears the venue layer; the name has one source.**<br>• `HeaderBand venue` sets the style from `requireVenueBand`.<br>• `BrandWordmark venue` shows the logo or the name; `BrandMark` is deleted.<br>• `BrandLink`, `BrandTitle` and `ShellBrandLink` take `venue`.<br>• `AppShellView` passes `VENUE_LAYER_DEFAULT`.<br>• `(public)/layout.tsx` renders a client `PublicBand` (it replaces `PublicBrand`) that gives `venue` to the guest band only.<br>• The root `themeColor` is the venue band.<br>• `t("venue.name")` at Home and in the prenota metadata → `VENUE_LAYER_DEFAULT.name`.<br>• New e2e helper | `header-band.tsx`, `brand.tsx`, `nav/shell-brand-link.tsx`, `(owner)/app-shell.tsx`, `(public)/layout.tsx`, `public-brand.tsx` → `public-band.tsx`, `src/app/layout.tsx`, `(owner)/page.tsx`, `prenota/[slug]/page.tsx`, `annulla/page.tsx`, `tests/components/{header-band,root-layout}.test.ts` (new), `brand-link.test.ts`, `brand-title.test.ts`, `public-brand.test.ts` → `public-band.test.ts`, `e2e/helpers/design.ts` (new), `e2e/app-shell.spec.ts` | `header-band.test.ts`: the style is exactly `--color-band:#1C4130;--color-band-ink:#F7F8F6`; without `venue` there is no style. In `src/`, `t("venue.name")` appears only in `venue-layer.ts`. Fails: no prop, and four uses.<br>`brand-link.test.ts`: no brand-mark, the name as text; a logo fixture gives one `img` with the alt and no text.<br>`public-band.test.ts`: `/prenota/x` has the style; `/login` has none.<br>`root-layout.test.ts`: both `themeColor` entries are `#1C4130` | e2e `app-shell.spec.ts` on signed-in `/`, light and dark:<br>• the band is `rgb(28, 65, 48)`;<br>• the band-ink is `rgb(247, 248, 246)`;<br>• `computedContrast` is ≥ 4.5.<br>Fails on main: the ink is cream. `product-brand.spec.ts:18-57` and `:135-138` unchanged |
| P2a-4 | **`CostiTheme` and `ProductLogo` split** (D4). The product layouts render `<CostiTheme /><ProductLogo />{children}`. The order guard starts at `DONE = 0` | `src/components/costi-theme.tsx` (new), `product-logo.tsx` (new), `product-scope.tsx` (deleted), the two product layouts, `tests/components/product-scope.test.ts` → `costi-theme.test.ts`, `costi-theme-order.test.ts` (new) | The import of `@/components/costi-theme` fails (no module).<br>• The marker is exactly `<span data-brand="costi" hidden="">` with no children.<br>• The layouts render the marker before `picture`, and the children are its siblings.<br>• Forest stays the `themeColor`.<br>• Order guard: steps 1–8 do not mention `CostiTheme`.<br>• The `data-brand` allow-list is `app/globals.css`, `components/costi-theme.tsx`, `lib/design/tokens.ts` | `product-brand.spec.ts:16-59` green |
| P2a-5 | **`Badge` `highlight`** replaces `RecommendedBadge` | `ui.tsx`, `brand.tsx`, `tests/components/badge.test.ts`, `file-picker.test.ts` | `badge.test.ts`: `highlight` → `bg-highlight text-on-highlight`, dot `bg-on-highlight`, `data-tone="highlight"`. Fails: unknown tone | `badge.test.ts:23-31` green |
| P2a-6 | **`Card edge`**, used by the login card | `ui.tsx`, `login-screen.tsx`, `tests/components/card.test.ts` (new) | `card.test.ts`: `edge` → the first child is `span[aria-hidden].h-1.bg-gold`, and the root is `relative overflow-hidden`. Fails: no prop | `login-page.test.ts` green |
| P2a-7 | **`InfoNotice`** replaces `infoNoteClass` | `ui.tsx`, `trace-parts.tsx`, `tracciabilita/lotto/[id]/page.tsx`, `tracciabilita/produzione/[id]/page.tsx`, `tests/components/info-notice.test.ts` (new) | `role="status"`, classes `border-info bg-info-bg text-info`, and `infoNoteClass` appears nowhere in `src/`. Fails: no export | the trace tests green |
| P2a-8 | **`FactList` / `FactRow`** replace `Fact` / `FACT_LIST_CLASS` | `src/components/fact-list.tsx` (new), `trace-parts.tsx`, the trace pages, `tests/components/fact-list.test.ts` (new) | A `dl` grid of `dt.text-ink-muted` and `dd.num`; `FACT_LIST_CLASS` and `function Fact(` are gone. Fails: no module | `e2e/trace.spec.ts` green |
| P2a-9 | **`SegmentedControl`** replaces `CourseTabs` | `src/components/segmented-control.tsx` (new), `course-tabs.tsx` (deleted), `comanda/page.tsx`, `course-tabs.test.ts` → `segmented-control.test.ts` | Fails: no module.<br>• `role="tablist"` with a label;<br>• the selected tab has `aria-selected`, `bg-ink text-paper`;<br>• no tab has `bg-accent`;<br>• `comfort` → `min-h-tap-comfort`;<br>• a click calls `onSelect`;<br>• the comanda's tabs keep their names ("Antipasti · 2") | the `order-entry.spec.ts` tab tests and P3's T-W1 / W-b tests green |
| P2a-10 | **Tab labels at 15 px** | `nav/nav-classes.ts`, `tests/components/bottom-tabs.test.ts` | Each tab has `text-[0.9375rem]` and none `text-sm`. Fails | `app-shell.spec.ts` (360, five tabs) `expectPhoneFriendly` in both themes |
| P2a-11 | **Contrast and tap pins on Costì:** `HIGH_CONTRAST_PAIRS` checked on `PRODUCT_THEMES` in both themes; the `--spacing-tap` comment names WCAG 2.2 SC 2.5.5 and SC 2.5.8 | `globals.css` (comment only), `tests/lib/design/costi-contrast.test.ts` (new) | The comment contains "2.5.5" and "2.5.8", and the value is ≥ 2.75rem. Fails: no comment. The high-contrast part is a guard that is green at once (13.85, 14.76/11.68, 12.15/9.61, 13.85) | `kitchen-contrast.test.ts` green |

### P2b · Sala: re-skin + Direct comanda + W-a+ + W2 (10 commits; P2b-9 and P2b-10 gated)

| # | Step | Files | Failing-first test | Guards and e2e |
|---|---|---|---|---|
| P2b-1 | **Sala wears Costì:** `tavoli/layout.tsx` renders `<CostiTheme />`; `DONE = 1` | `src/app/(owner)/tavoli/layout.tsx` (new), `costi-theme-order.test.ts`, `e2e/order-entry.spec.ts`, `e2e/menu-tables.spec.ts` | Order guard: the step-1 roots render `CostiTheme`. Fails: no layout | e2e at 360, light and dark, on `/tavoli` and the comanda:<br>• body `rgb(247, 248, 246)` / `rgb(31, 41, 51)`;<br>• the h1 in Montserrat;<br>• band `rgb(28, 65, 48)`;<br>• primary ≥ 4.5;<br>• with "Alto contrasto" on, ink/surface ≥ 7.<br>The existing `expectPhoneFriendly` calls stay green |
| P2b-2 | **Sala type (D18).** The guard's `font-display` and `<dl` rules turn on for step 1 | `bill-sheet.tsx`, `close-sheet.tsx`, `split-panel.tsx`, `open-table-dialog.tsx`, their component tests, `costi-theme-order.test.ts` | The guard lists 4 `font-display` hits under `tavoli/**`, so it fails. The total has `num` and no `font-display` | `bill-close.spec.ts` green |
| P2b-3 | **W-a+:** the view tabs become a `SegmentedControl` with the ink fill. The guard's tablist rule turns on | `comanda/page.tsx`, `order-page.test.ts`, `costi-theme-order.test.ts` | `order-page.test.ts`: the selected tab is "Comanda"/"Conto" with `bg-ink`, no `bg-accent`; the ids `view-order` and `view-bill` are kept. Fails: `bg-accent`. Guard: no `role="tablist"` in `tavoli/**` outside the component | `bill-close.spec.ts` and the `order-entry.spec.ts` tab clicks green |
| P2b-4 | **Comanda header (D15, D17):**<br>• the "Tavolo ▾" disclosure with "Modifica coperti";<br>• the "Conto richiesto" toggle in the header;<br>• the offline sentence and error alerts;<br>• each PATCH then one `loadView()`;<br>• hidden on a closed session;<br>• the meta line `coversLine`.<br>New i18n: `tables.more.label` "Tavolo: altre azioni" and the button word "Tavolo" (da approvare) | `comanda/table-header.tsx` (new), `comanda/page.tsx`, `src/lib/i18n/messages/{it,en}.ts`, `tests/components/table-header.test.ts` (new), `order-page.test.ts`, `e2e/menu-tables.spec.ts` | `table-header.test.ts` (cases moved from `session-panel.test.ts`, §5c). Fails: no module.<br>• The toggle's `aria-pressed` follows `billRequested`; ✓ only when pressed; never `bg-accent`.<br>• "Tavolo ▾" has `aria-expanded` false, then true on a tap; the card holds "Modifica coperti"; the toggle is **not** inside the card.<br>• Covers validation (`tableError.covers_invalid`); `onChangeCovers(6)`.<br>• Offline: both are disabled, with one "Serve la connessione".<br>• Closed session: neither control is rendered.<br>`order-page.test.ts`:<br>• "Conto richiesto" → exactly `PATCH /api/table-sessions/<id>` `{ billRequested: true }`, then one more `/lines` read with no timer advance;<br>• "Salva coperti" → `{ covers: 6 }`.<br>Fails: nothing in the comanda | e2e `menu-tables.spec.ts:227-241` rewritten: B taps the occupied tile → the comanda → the header shows "4 coperti" → the toggle goes from `aria-pressed` false to true (PATCH 200) → "← Tavoli" → the tile shows "Conto richiesto"; `expectPhoneFriendly` |
| P2b-5 | **Lines first (D13):**<br>• the order card with the h2 "Comanda" above the course tabs, open on arrival;<br>• the per-course send is secondary;<br>• the empty hint;<br>• the summary button loses `aria-expanded`, scrolls to and focuses the h2;<br>• `expanded` and `onToggle` are deleted.<br>New i18n: `orders.lines.emptyHint` (da approvare) | `comanda/order-sheet.tsx`, `send-buttons.tsx`, `comanda/page.tsx`, i18n, `order-sheet.test.ts`, `send-buttons.test.ts`, `order-page.test.ts`, the e2e specs in §5c | `order-sheet.test.ts`, with no interaction:<br>• the draft `[data-line-id]` rows are present, under `getByRole("heading", { level: 2, name: "Comanda" })`;<br>• the summary has no `aria-expanded`;<br>• a tap calls `scrollIntoView` (mocked) and focuses the h2;<br>• no lines → the hint text.<br>`send-buttons.test.ts`: no button has `bg-accent`.<br>`order-page.test.ts`: in DOM order, h2 → course tablist → first `[data-menu-item-id]`; in the whole order view, exactly one `bg-accent` (the bar's primary) when drafts exist.<br>Fails: the lines are hidden | e2e `order-entry.spec.ts` (360): after adding one antipasto, its row is visible with no tap. The T-W1 count from the tile is still 4 `click()`s. P3-8 (iv) focus-not-obscured green |
| P2b-6 | **Sent lines fold (D14).**<br>• `foldSent(lines)` → per course `{ course, drafts, sent }`;<br>• the row button "Primi · 3 inviati" (`orders.sent.folded` one/other, da approvare) has `aria-expanded` and unfolds in place;<br>• voided lines are struck through inside | `src/lib/orders/order-view.ts`, `comanda/order-sheet.tsx`, i18n, `tests/lib/orders/order-view.test.ts`, `order-sheet.test.ts`, the e2e specs in §5c | `order-view.test.ts` `foldSent`. Fails: no export.<br>• Fired and voided lines go to `sent`; drafts, including queued ones, stay in `drafts`;<br>• the order of courses is service order;<br>• a course with only sent lines gives one fold row.<br>`order-sheet.test.ts`:<br>• a fired line is absent until "Primi · 1 inviato" is tapped (`aria-expanded` false, then true);<br>• then "Storna" is present;<br>• a voided line inside has `line-through`.<br>Fails: the sent lines show | e2e `firing.spec.ts`: "Storna" after unfolding (§5c) |
| P2b-7 | **Occupied tile → comanda (D12).**<br>• An occupied tile is a link.<br>• The scroll position is saved on tap and restored once.<br>• `SessionPanel`, `selectedId` for open tables and `updateSession` are deleted.<br>• i18n `orders.open`, `tables.panel.billLink` and `tables.panel.hide` are deleted (it and en). `tables.panel.needsConnection`, `.editCovers`, `.saveCovers` and `.bill` stay, now used by the header | `tavoli/page.tsx`, `table-tile.tsx`, `session-panel.tsx` (deleted), `src/lib/tables/grid-scroll.ts` (new), i18n, `table-tile.test.ts`, `tables-page.test.ts`, `session-panel.test.ts` (deleted), `tests/lib/tables/grid-scroll.test.ts` (new), `e2e/pwa.spec.ts`, `e2e/order-entry.spec.ts` | `table-tile.test.ts`: an occupied tile is `a[href="/tavoli/comanda?s=<id>"]` with `data-table-id` and `data-contrast-box`; a free tile is a `button`; a joined tile is neither. Fails: it is a button.<br>`grid-scroll.test.ts`: `saveGridScroll(312)` → `sessionStorage["tavoli.scroll"] === "312"`; `takeGridScroll()` returns 312 once, then null; a non-number is ignored; a `sessionStorage` that throws gives null (a product-requirement fallback, as P3 D4: the grid still works).<br>`tables-page.test.ts`: an occupied tap renders no panel and makes no PATCH; with 312 stored, `window.scrollTo(0, 312)` is called once after the first list render | e2e `pwa.spec.ts:148-158` rewritten: on a dead network, a tap on the occupied tile reaches `COMANDA_URL` with the same session id. New `order-entry.spec.ts` test: grid → occupied tile → the lines are visible in **one** tap; "‹ Tavoli" → `window.scrollY` equals the value before the tap (with the grid scrolled first) |
| P2b-8 | **Free table bottom sheet (D16)** | `tavoli/open-table-dialog.tsx`, `tavoli/page.tsx`, `tests/components/open-table-dialog.test.ts` | Fails: a card with `role="group"`.<br>• `role="dialog"`, `aria-modal="true"`, labelled "Apri Tavolo 2 (demo)";<br>• focus on the h2 at open;<br>• Esc, the scrim and "Annulla" call `onCancel`, and the page puts focus back on the tile;<br>• the session id is unchanged across retries (existing case kept) | e2e free-table flows unchanged (label "Coperti", "Apri tavolo"); `expectPhoneFriendly` with the sheet open, both themes |
| P2b-9 | **W2, gated on P3 BQ-1** (`unsentCount` on `/api/tables`). The tile shows `Badge tone="warning"` "Da inviare · n" after the opener line when n > 0. Its `aria-label` is `tileLabel(table)`, and the link keeps that name. `overlay-tables.ts` counts a session opened on this phone (P3 D12). `/tavoli` reads once when the outbox shrinks, never while hidden | as in P3-10: `table-tile.tsx`, `src/lib/tables/table-view.ts`, `src/lib/sync/overlay-tables.ts`, `tavoli/page.tsx`, i18n, their tests, `e2e/order-entry.spec.ts` | The P3-10 tests verbatim (`tileLabel`, the badge position, the local count, the read on drain). Fails: no field or export. **No placeholder count** | P3-10's e2e (two drafts → "Da inviare · 2"; after sending, gone) |
| P2b-10 | **Meta line, full, gated on DS-BQ-2:** "4 coperti · Giulia alle 20:14 · Coperto 4 × 2,50 €" (`coversLine`, `openedLine`, `copertoLine` joined with " · "), each part present only when its data is | `comanda/table-header.tsx`, `table-header.test.ts`, `e2e/order-entry.spec.ts` | `table-header.test.ts` with the DS-BQ-2 fixture fields: the exact meta text, the earlier-day form of `openedLine`, no coperto part when the venue has none. Fails: the fields are not read | e2e: the meta shows the opener's name. The waiter still sees no cost (existing waiter cost tests) |

### P2c–P2i · one route group per PR (template + specifics)

Each slice has the same two commits, plus its specifics.

**X-1 · CostiTheme on the group; `DONE = n`.**
- Failing first: the order guard.
- e2e: the slice's specs get the `e2e/helpers/design.ts` checks on one page per root, in light and dark:
  - the body is Off-white / Charcoal;
  - the h1 is in Montserrat;
  - the primary is ≥ 4.5;
  - the band shows the venue colour.
- The existing `expectPhoneFriendly` calls catch any overflow from the wider faces at 360.

**X-2 · Type and structure.**
- `font-display` → `Heading`, `SubHeading` or `costi/label`.
- `<dl>` → `FactList`; `role="tablist"` → `SegmentedControl`.
- Failing first: the guard lists the hits.
- The component tests of the changed files assert the new structure.

| Slice | Specifics (the builder re-greps at the slice's base) | Extra e2e |
|---|---|---|
| **P2c** Cucina (2) | `cucina/ticket-card.tsx` (allow-listed), `remaining-count.tsx`, `closed-section.tsx`, `produzione/[id]/batch-facts.tsx`, `riordino/rule-facts.tsx`, `margini` | `kitchen.spec.ts`: with high contrast on, ink/surface ≥ 7 in both themes; K-b `:136-142` green |
| **P2d** Home (3) | Home `page.tsx` renders `<CostiTheme />`; layouts for `spingere`, `altro`, `avvisi`; `dashboard/yesterday-tile.tsx` `dl` | `app-shell.spec.ts:49-55` and `password-login.spec.ts:92`: cream → Off-white |
| **P2e** Fatture (4) | `fatture/[id]/page.tsx` (2), `revisione/xml-summary.tsx` (3), `review-summary.tsx`, `qualita/quality-summary.tsx`, `pagamenti/[id]/page.tsx` | `invoice-upload`, `invoice-approval`, `xml-invoice` green |
| **P2f** Magazzino (5) | `magazzino/[ingredientId]/page.tsx`, `scostamenti/variance-row.tsx`, `sprechi/waste-costs.tsx`; **P2f-2** also moves the `tracciabilita/page.tsx` tabs to `SegmentedControl`; trace detail pages | `trace.spec.ts` green |
| **P2g** (6) | `chiusura/difference-card.tsx`, `prenotazioni/*-sheet.tsx` (6), `report/services-panel.tsx`. **P2g-3:** move `chiusura/day-picker.tsx` → `src/components/day-picker.tsx` (no alias). Failing first: its test imports the new path | `reservations-staff`, `reports`, day-close specs green |
| **P2h** (7) | `ricette/[key]/recipe-facts.tsx`, `costi/ricette/[key]/page.tsx`, `costi/fixed-cost-card.tsx` (2), `estratto-conto/statement-view.tsx`, `menu/menu-item-form.tsx`; the roots in §4.4 | `recipes`, `mfa`, `staff-pin` green |
| **P2i** `/prenota` (8) | `prenota/[slug]/page.tsx` and `annulla/page.tsx` render `<CostiTheme />` (no `style=`); **P2i-2** also moves the `slot-picker.tsx` services to `SegmentedControl` (the time buttons stay `aria-pressed`); `cancel-view.tsx`. The "(public)/prenota never mentions data-brand" assertion is replaced (§5c) | `reservations-public.spec.ts:261` and `product-brand.spec.ts:125-139`: cream → Off-white. Still no `img[alt="Costì"]`; the title is "Osteria Dei Rossi"; the band shows the name, with no link |

### P2j · Costì is the `:root` default; the osteria theme retires (3 commits)

| # | Step | Files | Failing-first test | Guards and e2e |
|---|---|---|---|---|
| P2j-1 | **Tokens and scope (gated on DS-BQ-1).**<br>• `@theme` gets `PRODUCT_THEMES.light` and the screen-dark block gets `.dark`.<br>• The osteria values and both `:has()` blocks are deleted; the font remap moves into `@theme inline`.<br>• `THEMES`, `BRAND` and `DERIVED` are deleted.<br>• Every `CostiTheme` use and `costi-theme.tsx` are deleted; the order guard becomes `no-scope.test.ts` | `globals.css`, `tokens.ts`, the group `layout.tsx` files (deleted when they only rendered the marker), Home and the prenota pages, the product layouts, `costi-theme.tsx` (deleted), `tokens.test.ts`, `costi-theme*.test.ts` → `no-scope.test.ts`, `e2e/product-brand.spec.ts` | `tokens.test.ts`: the `@theme` colours equal `PRODUCT_THEMES.light`; the dark block equals `.dark`; there is no other colour block and no `data-brand` in `globals.css`. Fails.<br>`no-scope.test.ts`: no file in `src/` names `data-brand` or `CostiTheme`. Fails | **DS-BQ-1 lands with or before this commit.** `ux-quick-wins-preserves`, `kitchen-contrast` (after DS-BQ-1) and `costi-brand-docs` green. e2e `product-brand.spec.ts:97-123`: the 404 page is Off-white |
| P2j-2 | **Fonts.**<br>• Delete the 6 Bodoni and Figtree woff2 files and their two OFL files.<br>• Montserrat and Inter are preloaded; the stacks name them.<br>• Update the README | `src/app/layout.tsx`, `globals.css`, `src/app/fonts/**`, `fonts.test.ts`, `e2e/fonts.spec.ts`, `e2e/product-brand.spec.ts` | `fonts.test.ts`: three files, two OFL files, 0 `preload: false`, no `bodoni` or `figtree` anywhere. Fails | `fonts.spec.ts` `:86-115` → "the 404 loads Montserrat and Inter, never Bodoni"; `product-brand.spec.ts:109-115` inverted the same way. No Google host |
| P2j-3 | **Docs** (E-1).<br>• ui-foundation §1–§3: one system and the venue layer; the §2 osteria table goes into a "History" paragraph; the §11 tables are untouched and its prose is updated.<br>• The strategy's §9.3 DS rows are annotated.<br>• `docs/ux/README.md`: the "Built" column | `docs/design/ui-foundation.md`, `docs/plans/2026-11-13-ux-strategy.md`, `docs/ux/README.md` | `design-system-docs.test.ts` extended:<br>• ui-foundation has no `Bodoni` outside "History";<br>• it names `venueLayer` and ADR-045;<br>• each DS0–DS8 row says "superseded" or "survives".<br>Fails | `costi-brand-docs.test.ts`, `m25b-docs.test.ts` green |

### 5a. Gating and sequencing

- P2a has no outside dependency. P2a-1 needs E-1.
- P2b-1..8 have no outside dependency. Gated steps:
  - P2b-9 waits for P3 BQ-1;
  - P2b-10 waits for DS-BQ-2.
  - When P2b-8 is done, the builder merges `origin/main` and builds whichever gated step is unblocked. If a gate is still closed: V3
    (for P2b-9) and V4 (for P2b-10).
- P2c–P2i follow one another. Before P2e and P2f, merge `main` (P2-7 and P2-2 change those screens; Q-L12).
- P2j-1 waits for DS-BQ-1 of this plan. P2j-2 and P2j-3 follow it.

### 5b. Variants

| ID | Trigger (open answer) | Replaces | Steps (each with its test) |
|---|---|---|---|
| **V1** Venue band per slice | Q-L2 answered "per slice, guests last" | D3 within P2a-3 | **V1.1** P2a-3 passes `venue` only in the shell; `PublicBand` gives the guest band none. Test: `public-band.test.ts` asserts no `style` on `/prenota/x`.<br>**V1.2** P2i-1 adds it. Test: the same file asserts the style; `product-brand.spec.ts:135` unchanged |
| **V2** Sheet headings in `costi/section` | Q-L4 answered "h3 = 24/30" | D18's `h3` rule | **V2.1** `SubHeading as="h3"`. Test: `close-sheet.test.ts` and `split-panel.test.ts` assert the h3 has `font-display text-[1.5rem]` |
| **V3** W2 in a follow-up PR | P3 BQ-1 not on `main` when P2b-8 is done | P2b-9 in this PR | **V3.1** P2b ships P2b-1..8 (and P2b-10 if DS-BQ-2 is there). Test: those steps' suites.<br>**V3.2** `feat/ux-p2b-w2`, cut from `main` after DS-BQ-1, builds P2b-9 with exactly its tests |
| **V4** Full meta line in a follow-up PR | DS-BQ-2 not on `main` when P2b-8 is done | P2b-10 in this PR | **V4.1** P2b ships with the meta line `coversLine` only. Test: `table-header.test.ts` asserts the meta text is exactly "4 coperti".<br>**V4.2** `feat/ux-p2b-meta`, after DS-BQ-2, builds P2b-10 with its tests |
| **V5** Unlisted routes mapped differently | Q-L3 answered with another mapping | §4.4's bold entries | **V5.1** Move roots in `RESKIN` and in the slice tables. Test: the order guard with the new mapping |
| **V6** `DayPicker` already shared | P2-2 moved it before P2g | P2g-3 | **V6.1** P2g-3 is dropped. Test: the order guard's step 6 is green with the shared picker imported |

### 5c. Existing assertions that change (each stricter or equal)

| Test (file:line) | Step | Before | After | Why it is not weaker |
|---|---|---|---|---|
| `brand-link.test.ts:17`, `brand-title.test.ts:18` | P2a-3 | the brand-mark is present | no brand-mark; the name as text; a logo fixture gives an `img` with the alt and no text | The placeholder is retired by the spec; both paths are covered |
| `public-brand.test.ts:41` | P2a-3 | the product band has no mark | `public-band.test.ts`: the product band has no mark **and** no style; the guest band has the exact style | Additive |
| `product-scope.test.ts:17-31` | P2a-4 | a `contents` wrapper | the exact marker markup, and the marker → logo → children order | Exact |
| `product-scope.test.ts:87-94` | P2a-4, P2i-1 | `(public)/layout` and `prenota/**` never name the scope | P2a-4: the same rule with `CostiTheme`. P2i-1: the order guard (`prenota` **must** render it; `(public)/layout.tsx` must not) | Exact per root |
| `product-scope.test.ts:96-107` | P2a-4, P2j-1 | a 3-file allow-list | one file swapped, then an empty list | Exact |
| `file-picker.test.ts:67-` | P2a-5 | `RecommendedBadge` | `badge.test.ts` `highlight` | The same pair, plus a tone attribute |
| `course-tabs.test.ts` (all) | P2a-9 | `CourseTabs` | `segmented-control.test.ts` with the same assertions, plus `comfort` | Equal plus |
| `order-sheet.test.ts:30-31`, `:63-64` | P2b-5 | the summary's `aria-expanded` is true or false | the summary has no `aria-expanded`; the lines are present with no interaction; a tap scrolls and focuses the h2 | The lines are asserted directly; the summary's new behaviour is asserted |
| `order-sheet.test.ts:125`, `:197-199` | P2b-5 | the summary's name; never `bg-accent` | unchanged | Equal |
| `order-sheet.test.ts:180-181` | P2b-5 | the first bar button has `aria-expanded` | the first bar button is the summary with **no** `aria-expanded` and a scroll/focus effect | The new behaviour is pinned |
| `order-page.test.ts:123` (`openSheet`) and its callers | P2b-5 | a click opens the lines | the helper is deleted and the lines are already present; the summary names at `:168`, `:402`, `:524`, `:1583`, `:1711`, `:1719`, `:1727` are unchanged | Equal; one tap fewer is the feature |
| `order-page.test.ts` and `order-sheet.test.ts` cases on fired or voided lines ("Storna", struck-through) | P2b-6 | the line is visible in the open sheet | first tap "<Portata> · n inviati" (and assert its `aria-expanded`), then the same assertions | Stricter: the fold is asserted too |
| `send-buttons.test.ts` | P2b-5 | no class assertion | no `bg-accent` | Additive |
| `order-page.test.ts`, the view tabs | P2b-3 | — | `bg-ink`, no `bg-accent` | Additive |
| `session-panel.test.ts` (all, `:23-174`) | P2b-4, P2b-7 | the panel cases | Each case moves:<br>• the toggle, ✓, `aria-pressed`, QW11 never-primary, the covers edit, offline disabled, the error → `table-header.test.ts`;<br>• "Prendi la comanda" link, offline included → `table-tile.test.ts` (the occupied tile **is** the link);<br>• "Conto e chiusura" → the Conto-tab tests in `order-page.test.ts`;<br>• "Chiudi" hides the panel → removed with the panel; its replacement is "‹ Tavoli" (QW12 tests unchanged) | Every behaviour that remains keeps a test; the removed one has its replacement stated |
| `tables-page.test.ts:240-279` | P2b-4, P2b-7 | the offline panel, the PATCH `billRequested`, the covers from `/tavoli` | the same three in `order-page.test.ts`; `tables-page.test.ts` asserts no panel and no PATCH | The same calls, asserted on the screen that now makes them |
| `table-tile.test.ts` (role of an open tile) | P2b-7 | `button` | `a[href]` for occupied, `button` for free | Exact element and href |
| `open-table-dialog.test.ts` (card, `role="group"`) | P2b-8 | a card | a dialog with `aria-modal`, focus in and focus return | Stricter |
| `tokens.test.ts:119-150`, `:190-254`, `:350-358` | P2j-1 | osteria mirrors, four blocks | `@theme` = `PRODUCT_THEMES.light`, dark = `.dark`, no other block; status tones pinned to literals | One theme, pinned exactly |
| `fonts.test.ts:8-19`, `:66-79`, `:102`, `:116-132` | P2j-2 | six files, four non-preloaded | three files, zero non-preloaded | Exact lists |
| `tests/design/kitchen-contrast.test.ts:4`, `:19` (DS-BQ-1) | P2j-1 | `THEMES` | `PRODUCT_THEMES` | The same pairs and 7:1, on the theme that ships |

**e2e, before and after.** From a grep of `e2e/` for colours, `toHaveCSS`, `getComputedStyle`, `expectPhoneFriendly`, class-name
selectors, the panel, "Prendi la comanda", the summary or sheet toggle, `lineRow` and the leave sheet.

- **No e2e selector uses a class name** (zero hits for `bg-accent`, `bg-ink`, `bg-paper`, …). The re-skin moves no locator.

**Colour and font assertions that flip:**

| Assertion | Step | Change |
|---|---|---|
| `app-shell.spec.ts:53`, `password-login.spec.ts:92` | P2d-1 | cream → Off-white |
| `reservations-public.spec.ts:261`, `product-brand.spec.ts:129` | P2i-1 | cream → Off-white |
| `product-brand.spec.ts:108` | P2j-1 | cream → Off-white |
| `product-brand.spec.ts:109-115`, `fonts.spec.ts:32-37`, `:86-115` | P2j-2 | Bodoni → Montserrat |

**Unchanged and green:**
- `product-brand.spec.ts:18-57` and `:135-138`;
- `kitchen.spec.ts:136-142` and `:176`;
- every `expectPhoneFriendly` / `expectPhoneFriendlyBothThemes` call: `menu-tables`, `firing`, `alert-rules`, `alerts`, `reports`,
  `batch-actions`, `batches`, `bill-close`, `push-forecast`, `dashboard`, `reservations-staff`, `booked-covers`, `invoice-upload`,
  `kitchen`.

**Direct comanda:**
- **The summary button.** `e2e/helpers/order-ui.ts:8` and the copy in `order-entry.spec.ts:38`, `bar` = button `/^Comanda/`:
  **unchanged**. The button still exists.
- **Clicks on the summary.** These now scroll to the lines instead of opening them: `firing.spec.ts:70`, `:100`; `offline.spec.ts:90`,
  `:290`, `:300`, `:302`; `kitchen.spec.ts:88`, `:260`; `sell-by-weight.spec.ts:87`; `simulation/service.spec.ts:210`, `:233`, `:266`,
  `:333`; `order-entry.spec.ts:196`, `:247`, `:454`. They stay valid; each next assertion on a **draft** row is unchanged.
- **Summary texts.** `order-entry.spec.ts:168`, `:190`, `:246`, `:335` are unchanged.
- **`aria-expanded` on the summary.** `kitchen.spec.ts:381-382`, `:411` and `simulation/service.spec.ts:211` are replaced by: the h2
  "Comanda" is focused after the click, and the next `lineRow` is visible. The state no longer exists; the focus and visibility are the
  replacement.
- **Sent lines** (`lineRow` reads after a send: `firing.spec.ts` 13 uses, `order-entry.spec.ts` 16, `offline.spec.ts` 5,
  `sell-by-weight.spec.ts` 1). Each read of a line that is fired or voided at that point first clicks the course's fold row,
  `getByRole("button", { name: /^<Portata> · \d+ inviat/ })`. "Storna" at `firing.spec.ts:107-131` follows the unfold. Reads of draft
  rows are unchanged. The builder lists each edited line in the PR.
- **The panel.** `menu-tables.spec.ts:227-241` → the comanda header (P2b-4).
- **Dead-network tap.** `pwa.spec.ts:148-158` → a direct tap (P2b-7).

**Leave sheet (QW12): unchanged and green.**
- `order-entry.spec.ts:337-344`, `:355`; `offline.spec.ts:207-210`;
- `leave-sheet.test.ts` (all);
- `order-page.test.ts:1362-1661` (dialog-scoped). The exits are the same; only the tile path into the comanda changed.

**The free-table path keeps its locators** (label "Coperti", button "Apri tavolo"); only the container becomes a sheet:
- `order-ui.ts:43-57`, `helpers/offline.ts:182-185`;
- `pwa.spec.ts:90-93`, `mfa.spec.ts:333-337`;
- `offline.spec.ts:146`, `:193`, `:261`;
- `order-entry.spec.ts:323`, `:384`, `:415`, `:519`.

## 6. Acceptance criteria

1. **Venue layer.**
   - `venueLayer()` accepts `#1C4130` (10.67 / 4.43).
   - It refuses `band_ink_contrast` and `rule_contrast` with the ratio, and never substitutes a colour.
   - `requireVenueBand` throws on a refusal.
   - `Venue` and `venueSchema` are the documented SP9 contract.
2. **Band.**
   - Every venue band is `#1C4130` with Off-white ink in both schemes, and the Coral rule stays.
   - Product pages stay Forest with "Costì".
   - The theme-color is `#1C4130`.
   - The venue name has one source.
3. **One system.**
   - Each slice's routes render with Costì values, Montserrat headings and Inter text, in light and dark.
   - The order guard proves the order.
   - After P2j, `src/` has no `data-brand`, `CostiTheme`, `THEMES`, `BRAND`, `DERIVED`, Bodoni or Figtree.
4. **Components.**
   - `Badge highlight`, `Card edge`, `InfoNotice`, `FactList`/`FactRow` and `SegmentedControl` exist, and each replaced path is gone.
   - A re-skinned group has no `<dl>`, `role="tablist"` or `font-display` outside the allow-list.
5. **Contrast.**
   - `CONTRAST_PAIRS` holds on Costì in both themes.
   - `HIGH_CONTRAST_PAIRS` is ≥ 7:1 on Costì.
   - The e2e computed checks pass on every re-skinned group.
6. **Direct comanda** (`p3-sala-waiter.md` §10, with the lead's change).
   - **Tiles:**
     - an occupied tile opens its comanda in one tap, online and on a dead network;
     - a free tile opens a bottom sheet (covers, "Apri tavolo") that returns focus to the tile when dismissed;
     - "‹ Tavoli" returns to the grid's scroll position.
   - **Order screen:**
     - the lines are open above the course tabs;
     - drafts are listed in full;
     - sent lines are folded per course and unfold in place with "Storna";
     - the bar's summary scrolls to and focuses "Comanda";
     - the bar's "Invia …" is the one primary.
   - **Header:**
     - "Conto richiesto" is a pressed-secondary toggle in the header (one tap, `aria-pressed`, never primary);
     - "Modifica coperti" is in "Tavolo ▾";
     - offline, both are disabled with "Serve la connessione";
     - each write reads the order once.
   - The session panel is gone; QW12, W1, W-b, W3 and W4 are unchanged.
   - The meta line shows the covers, and the opener and coperto once DS-BQ-2 is in.
   - The view tabs use the ink fill.
   - W2 shows when P3 BQ-1 is in; there is no placeholder anywhere.
7. **Everywhere.**
   - No new poll. No money figure added for the waiter: the coperto is a sale charge the waiter already saw on the panel.
   - Italian first, with English pairs. New wording is marked "da approvare".
   - The CSP header is unchanged, the fonts are self-hosted, and there is no new dependency.
   - The definition of done in `CLAUDE.md`, including ≥ 80 % line coverage on new code.

## 7. Validation (strategy §9.1)

**Automated contrast gate.**
- Unit:
  - `CONTRAST_PAIRS` on `PRODUCT_THEMES` in both themes;
  - `HIGH_CONTRAST_PAIRS` on Costì (P2a-11);
  - `venueLayer()` (P2a-2).
- e2e: `e2e/helpers/design.ts` computes contrast from the **computed** colours, using `contrastRatio` from `src/lib/design/contrast.ts`.
  It checks band-ink on band, the primary's label and fill, body ink on paper, and, in high contrast on Sala and Cucina, ink on surface
  ≥ 7.

**360 × 740 in both themes.**
- Each X-1 runs its specs at 360 in light and dark.
- The PR body carries screenshots at 360 light and dark, and at 1280 where a laptop layout exists.
- The 320 reflow checks from P3 stay.

**Reduced motion.** `expectReducedMotion(page)` emulates `reducedMotion: "reduce"` and asserts that the computed `animation-duration`
of `main > *` is ≤ 0.01 ms. It runs once per slice; the CSS block stays guarded by `tokens.test.ts:248-253`.

**No task-time regression on T-W1 and T-C1.**
- Automated:
  - T-W1 (free table) keeps its four `click()`s (P3 e2e);
  - the occupied path is one tap (P2b-7);
  - T-C1 keeps its count in `kitchen.spec.ts`.
- Observed, as in P3 §7: a test tenant with demo data, participant codes, no recordings, sheets in DigiAlto-Ops
  `clients/osteria-dei-rossi/deliverables/<date>-ux-p2/`. The tasks follow `p3-sala-waiter.md` §10.5:
  - "see what table 2 ordered": expected 1 tap (3 before);
  - "add a dish to an open table and send it": 1 tap + dish + "Invia";
  - **"Conto richiesto": 2 taps** (tile → toggle, the same as before, because of the lead's change; §10.5 had 3);
  - T-W1 and T-W2 unchanged.
- The tap counts above come from the code; time is measured. The pass rule is §9.1's, against P0 once P0 exists.

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Two themes coexist for weeks; a client navigation between groups flips the look | Bounded by the D5 guard and P2j. The band and the theme-color are uniform from P2a-3 |
| The Costì faces are wider: overflow at 360 | The existing `expectPhoneFriendly` calls in both themes, and the 320 reflow checks |
| The Costì faces are not preloaded until P2j | `adjustFontFallback`; P2j-2 preloads them (D11) |
| The band's `style` attribute under `style-src 'unsafe-inline'` | Hex values from `venueLayer()` only, two properties, schema tests, the name as text; the CSP header is unchanged and tested; recorded in ADR-045 |
| A long comanda pushes the menu down | §10.2 folds sent courses (P2b-6); the summary in the bar jumps back to the lines; observed in validation |
| A "Conto richiesto" tapped by mistake in the header | It is a secondary toggle that is undone with one more tap, never primary, and its state is announced by `aria-pressed` |
| Losing the grid position after "‹ Tavoli" | The scroll restore (P2b-7). If `sessionStorage` is refused, the grid opens at the top (tested) |
| The Sala PR is the largest | 10 commits, each test-first. Re-skin commits come first, then behaviour; P3's e2e (T-W1, W-b, focus) runs throughout; the gated steps can split off (V3, V4) |
| P2b-9 and P2b-10 depend on two builders | V3 and V4 split them off cleanly. No placeholder is shipped |
| Conflicts with P2-2 and P2-7 | Merge `main` at each slice base; V6 |
| `tests/guards` and `tests/app` are in neither path list | §2.7 shows none goes red. Any surprise goes to the lead as a trace tail first |
| **Security and privacy** | No new endpoint in this builder's work, no secret, no environment variable, no dependency. The existing secrets stay in Vercel env, Supabase Vault and GitHub environments. The fonts stay self-hosted (no font provider). The waiter sees no new money figure. `sessionStorage` holds a scroll offset only. The PATCH reuses the `withApi` roles and RLS. DS-BQ-2 adds no cost key (its own tests) |

## 9. Build-queue items and lead exceptions

**DS-BQ-1 · `tests/design/kitchen-contrast.test.ts` follows the one theme** (gates P2j-1; outside this builder's paths)

- Line 4: `import { AAA_TEXT, HIGH_CONTRAST_PAIRS, PRODUCT_THEMES, type Theme } from "@/lib/design/tokens";`
- Line 19: `expect(contrastRatio(PRODUCT_THEMES[theme][fg], PRODUCT_THEMES[theme][bg])).toBeGreaterThanOrEqual(AAA_TEXT);`
- The same pairs and threshold. Equal strictness.
- Default: the lead lets this builder make these two lines in P2j-1 (Q-L1).

**DS-BQ-2 · `orderSession` carries the opener and the coperto** (gates P2b-10; platform builder)

- `src/server/orders/output.ts:37-45` gains:
  - `waiter: z.strictObject({ displayName: z.string() })`;
  - `openedAt: z.string()`, `openedToday: z.boolean()`;
  - `coperto`, with the same shape as `tileSession.coperto` (`src/server/tables/output.ts`).
- The values come from the lines RPC (a new migration, numbered after `main`'s newest).
- Roles and RLS are unchanged.
- Tests:
  - pgTAP: the exact session keys, plus the three new ones;
  - another tenant's session is not readable (existing);
  - the recursive cost-key scan stays 0;
  - Vitest: the `orderViewOutput` JSON-schema snapshot; the waiter cost-key test is green (`coperto` is a sale charge, as on the tile).
- Fixtures in `tests/helpers/**` gain the fields within DS-BQ-2.

**P3 BQ-1 · `unsentCount` on `/api/tables`** (gates P2b-9). Unchanged from `docs/plans/2026-11-14-ux-p3-sala.md` §9.

**E-1 · Docs paths** (`docs/**` is in neither list). These are ADR-045, the status line of ADR-042 (P2a-1), and ui-foundation, the
strategy annotations and the `docs/ux/README.md` Built column (P2j-3).
- Default: this builder writes them (Q-L1).
- The designer, after merge: `costi-design-system.md` §9 should say `venue-layer.ts` (D6); `p3-sala-waiter.md` §10.3 and §10.5 should
  record the lead's "Conto richiesto" change.

**No `tests/config/**` change is needed** (§2.7).

## 10. Open questions for the lead

| # | Question | Default |
|---|---|---|
| Q-L1 | DS-BQ-1 (two lines in `tests/design/`) and E-1 (docs): may this builder make them? | Yes, as P3 Q-L2 |
| Q-L2 | Should the venue band apply on every venue band from P2a (D3: the dark band changes from `#16301F` to `#1C4130` and the band-ink from cream to Off-white on pages not yet re-skinned and on `/prenota`), or per slice (V1)? | D3 |
| Q-L3 | Routes not in §11: `altro` and `avvisi` → 3; `pagamenti` → 4; `menu`, `dispositivi`, `doppia-verifica`, `password`, `sicurezza` → 7? | As proposed (V5 otherwise) |
| Q-L4 | Type outside the ramp: the sheet `h3` (`costi/label`, or V2), the 28 px ticket name (allow-listed), the bill total (Inter `num`). Does the designer confirm? | D18 and §4.4 |
| Q-L5 | Direct comanda details §10 leaves open:<br>(a) Does the fold row reset to folded after a send in the same visit? Default: no, it keeps the waiter's choice until they leave.<br>(b) Is the "Tavolo" button word and "Tavolo: altre azioni" final wording? It is marked "da approvare".<br>(c) With the toggle in the header, is a separate "Conto richiesto" badge still wanted? Default: no; the status badge already says it (D15).<br>(d) The scroll restore applies only through "‹ Tavoli" and the browser back; also after the leave sheet's "Esci comunque"? Default: yes, any return to `/tavoli` in the same tab | The defaults given |
| Q-L6 | P3's plan still lists P3-10 (W2) and P3-11 (W-c) behind DS-BQ-1. With W-c superseded and W2 now P2b-9 here, should P3's V1.2 follow-up be cancelled so W2 is built once? | Yes: W2 is built only as P2b-9 (or V3.2) |
| Q-L7 | DS7 `StateView`, DS8 the theme toggle and the `LedgerRow` props go to P4 or a later small PR? | Yes |
| Q-L8 | Keep a short "History" paragraph for the osteria theme in ui-foundation? | Yes |
| Q-L9 | `VENUE_LAYER_DEFAULT` lives in `venue-layer.ts` rather than `tokens.ts` (D6). The designer updates `costi-design-system.md` §9 | Yes |
| Q-L10 | Should the logo `src` stay same-origin only until SP9 decides on Storage? | Yes |
| Q-L11 | Every accepted accent gets Off-white band-ink (§4.2). Keep the Charcoal branch as the spec says? | Keep |
| Q-L12 | Should P2e and P2f wait for the P2-7 and P2-2 PRs to merge? | Yes |
| Q-L13 | DS-BQ-2 goes to the platform builder's queue: where should it sit relative to P3 BQ-1 and SP0? | Right after P3 BQ-1 (both are small `src/server` output extensions) |

## Lead decisions

Decided by the lead, 2026-11-14. These override the text above.

**Venue layer and scope**
- **The venue layer is exactly a name, an optional logo and one accent colour.** The accent sets `--color-band`;
  `--color-band-ink` is derived from it. Built in P2a-2 and P2a-3.
- **`venueLayer()` refuses an invalid accent:** band-ink contrast under 4.5:1, or Coral against the band under 3:1. It returns a typed
  refusal, and `requireVenueBand` throws. There is **no fallback colour** (founder rule B). Both refusal cases and a valid case are
  tested in P2a-2 (a)–(f).
- **Tenant theme storage stays out** (no DB, no API). A code-side osteria venue object (`VENUE_LAYER_DEFAULT`) is typed as the contract
  SP9 will produce (`Venue`, `venueSchema`, §4.2).

**Plan and slicing**
- **The plan is final**; there is no draft header.
- The first slice is tokens + venue layer + core components (P2a).
- Then one route group per PR in `costi-design-system.md` §11's order (P2b–P2i), then P2j.

**Sala slice (P2b)**
- **Direct comanda** (founder feedback) is folded into the first route-group slice. It is planned from `docs/ux/p3-sala-waiter.md` §10,
  which is on `main` at ee092e6.
- **Change to `p3-sala-waiter.md` §10.3:** "Conto richiesto" stays in the order screen **header** as a pressed-secondary toggle (one tap,
  `aria-pressed`, never primary, as QW11). It is **not** inside the "Tavolo ▾" disclosure (D15, P2b-4).
- **W-c is superseded** by §10 and removed from scope. The session panel goes away (P2b-7).
- **W2 stays**, gated on P3 BQ-1 (`unsentCount` on `/api/tables`), as P2b-9 or variant V3. There is no placeholder count.
- **W-a extended:** the Comanda/Conto view tabs get the ink fill for the selected tab (P2b-3).

Plan approved by the lead, 2026-11-14 (these override the text above):

- **Q-L1: yes.** This builder makes DS-BQ-1 (the two lines in `tests/design/kitchen-contrast.test.ts`, in P2j-1) and E-1 (the doc
  writes: ADR-045, ADR-042's status line, ui-foundation). These are the only exceptions to this builder's paths.
- **Q-L2: D3, the venue band everywhere from P2a**, `/prenota` included: one consistent band rather than per-slice drift. V1 does not
  fire.
- **Q-L3 to Q-L5, Q-L7 to Q-L11: the defaults.**
- **Q-L6: yes.** P3's W2/W-c follow-up (P3 V1.2) is cancelled. W2 is built once, as P2b-9 (or V3.2); W-c is superseded by
  p3-sala-waiter.md §10.
- **Q-L12: no wait.** P2-2 (#91) and P2-7 (#103) are both already on `main`, so P2e and P2f are not gated on them.
- **Q-L13:** DS-BQ-2 sits right after P3 BQ-1 in the platform builder's queue (the lead tells it).
- **Delivery:** one PR per slice, marked ready as soon as its code is written. After each slice merges, the designer checks it against
  Figma (costi-design-system.md §10).
