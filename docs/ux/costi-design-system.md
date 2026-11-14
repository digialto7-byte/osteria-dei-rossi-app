# Costì design system (the whole app)

- **Status:** founder decision 2026-11-14 (via the lead): **one Costì design system for the whole app**; §1, §9–§11 rewritten for it ·
  **Author:** UX/UI designer · **Date:** 2026-11-14
- **Sources (the only ones used):** DigiAlto-Ops `knowledge/agency/products/costi/brand.md` (approved 2026-11-13), ADR-042,
  `docs/design/ui-foundation.md` §1–§7 and §11, `docs/plans/2026-11-13-costi-product-brand.md`, `docs/plans/2026-11-13-ux-strategy.md` §6.
- **Authority.** The token **values** live in code (`PRODUCT_THEMES` in `src/lib/design/tokens.ts`) and in `ui-foundation.md` §11, which a
  test keeps equal to the code. This document does not repeat the value tables; it says **how to use them** on product screens and how
  the Figma library is organised. If this file and §11 ever disagree, §11 wins.
- **Italian wording.** Strings already in `src/lib/i18n/messages/it.ts` are quoted as they are. Any new Italian product wording in this
  folder is marked **(da approvare)** until the copywriter drafts it and the founder approves it (brand.md, "Voice").

## 1. One design system; the venue is a layer

**Founder decision, 2026-11-14 (top design priority).** The whole app uses **one** design system, Costì: sign-in, the console **and every
screen inside a venue**. A venue is a **configurable layer** on top of it (§9): its name, its logo and one accent colour. The osteria is
simply the first configuration. This **replaces** the earlier rule "venue screens keep the venue's full theme" (ADR-042's split, Q-CB6's
venue look inside the app) and strategy decision **D2** (osteria-only palette, `docs/plans/2026-11-13-ux-strategy.md`).

| Surface | Base | Venue layer | Name in the band |
|---|---|---|---|
| Sign-in `/login` (password, e-mail code, PIN), two-step pages, `/dispositivo` | Costì | none | **Costì** (founder, 2026-11-14) |
| Costì · Console (`costi-console.md`) | Costì | none | **Costì · Console** |
| Staff sign-in e-mail; installed app icon, splash, manifest, favicon, tab title | Costì | none | n/a |
| Every signed-in venue screen (Home, Sala, Cucina, Gestione, Anagrafica, Registro, …) | Costì | **yes** (name, logo, accent) | the **venue's** name (or logo) |
| Guest booking `/prenota/<slug>`, guest e-mails | Costì | **yes**; no Costì logo or name shown to guests | the venue's name, no link |
| Onboarding wizard (A2), sales and demo pages | Costì | none | Costì |

**What this means in practice:** every screen has the same type (Montserrat 600 headings, Inter 400/700 text), the same surfaces, text,
actions, focus and status colours, and the same components. The only thing that changes from venue to venue is the band (colour, name or
logo) and the thin accent rule under it (§9). Staff who work in two venues, and DigiAlto supporting many, see one app.

**Retired:** the osteria theme (`THEMES` in `tokens.ts`: cream paper, black ink, Bodoni Moda, Figtree) once §11's last step ships; until
then it stays only on the screens not yet re-skinned.

## 2. Colour: roles and rules

Values: `ui-foundation.md` §11. Here are the **roles** a designer chooses from, by token name, so a Figma screen maps 1:1 to code.

| Role in a design | Token | Light | Dark | Rule |
|---|---|---|---|---|
| Page | `paper` | Off-white | Charcoal | Default background |
| Card, input, secondary button | `surface` | white | derived | At most two cards per screen |
| Hover, chip, neutral badge | `sunk` | Sage | derived | Never put Coral on it (2.11, fails) |
| Text | `ink` | Charcoal | Off-white | Body, labels, values |
| Secondary text | `ink-muted` | derived | derived | Hints, meta; never for the only copy of a fact |
| Hairline | `rule` | derived | derived | Decorative only |
| Input border, required boundary | `rule-strong` | derived | derived | ≥ 3:1 on page and card |
| Header band | `band` / `band-ink` | Forest / Off-white | same | Band stays Forest in both modes |
| Primary action | `accent` / `on-accent` | Forest / Off-white | Sage / Charcoal | **One per screen** |
| Link, quiet button | `accent-ink` | Forest | Sage | Underlined, 44 px tall |
| Focus ring | `focus` | Forest | Sage | 3 px + 2 px offset, never removed |
| Accent line, mark, icon detail | `gold` (= Coral) | Coral | Coral | **Never text, never a required boundary** |
| Badge fill | `highlight` / `on-highlight` | Coral / Charcoal | same | The only text allowed on Coral is Charcoal (5.75) |
| Status | `success`, `warning`, `danger`, `info` + `-bg` | product tokens, same as the venue | | Always with a word, never colour alone |

**Coral, in one paragraph.** Coral is the brand's spark, used sparingly: the 2 px rule under the band, the accent above the ì, small
graphic details (the pattern stroke, an icon detail ≥ 3:1 against its background, which is true only on Forest at 3.82 and never on
Off-white, white or Sage), and badge fills with Charcoal text. Coral **never** carries text on light surfaces, never holds white text, never
sits on Sage, and is never the only sign of a state.

**Coral buttons.** The brand allows "a coral button with Charcoal text" (5.75). In the **app** the one primary action stays Forest
(`accent`), as the code does today: one primary per screen, and a Forest primary reads the same in every product screen. A Coral button is
proposed **only for marketing and sales surfaces** (landing, demo booking), never in the app. Founder decision **Q-DS1** (§9).

## 3. Type

Faces are self-hosted (no Google request): **Montserrat 600** for headings only (lead decision Q-CB4), **Inter 400 / 700** for everything
else. Montserrat 700 is not loaded, so designs must not use it.

| Style (Figma text style) | Face | Size / line | Use |
|---|---|---|---|
| `costi/display` | Montserrat 600 | 40 / 44 | Sign-in h1 only (same size as today's login title) |
| `costi/title` | Montserrat 600 | 34 / 37 | `Heading` h1, one per screen |
| `costi/section` | Montserrat 600 | 24 / 30 | `SubHeading` h2 |
| `costi/wordmark` | Montserrat 600, caps, +0.1 em | 21 / 21 | Band wordmark ("Costì" on product pages; the venue's name on venue pages) |
| `costi/body` | Inter 400 | 16 / 24 | Body and inputs (inputs stay 16 px: iOS does not zoom) |
| `costi/label` | Inter 700 | 16 / 22 | Labels, buttons, row titles |
| `costi/label-sm` | Inter 700 | 15 / 20 | Tabs, pills |
| `costi/meta` | Inter 400 | 14 / 20 | Hints, meta lines (`ink-muted`) |
| `costi/num` | Inter 400 + tabular figures | as context | Amounts `1.234,50 €`, codes, dates |

No italic (no italic face is loaded). Sentence case for buttons and headings; the only caps are the band wordmark (CSS, so screen readers
read the real name).

## 4. Space, size, shape

Same as the venue system, so components are shared: 16 px gutter, `max-w-md` column, 24 px vertical rhythm, 16 px between fields, label
6 px above its control; radius 8 (controls), 12 (cards), full (pills, badges); every target **≥ 44 × 44 px** (`tap`; meets WCAG 2.2 SC 2.5.5
AAA, exceeds 2.5.8 AA). Depth: card border + one soft shadow; nothing else. Motion: the one 420 ms reveal and 150 ms state changes; all
zeroed under `prefers-reduced-motion`.

## 5. Brand elements

| Element | Rule in the product UI |
|---|---|
| **Logo** | Horizontal logo in the page on sign-in and device screens (`ProductLogo`); reversed white version only on Forest. Files are **placeholders** until the founder's vectors arrive (BRAND-1). Minimum clear space and minimum size: to be set from the founder's files (Q-DS3) |
| **App icon** | Mark on a Forest rounded square; maskable artwork inside the central 80 % |
| **Chef's-hat pattern** (Sage outline, Coral stroke accent) | Decorative only, `aria-hidden`; allowed as a band or empty-state background on product surfaces at low density. Never behind text that must be read; never inside a venue's screens (they carry the venue layer). Not in the app yet: needs an SVG asset (svg-designer) and founder approval of the drawing (Q-DS4) |
| **Venue-type line icons** (cloche, cocktail glass, cutlery, wine, burger, coffee) | For the onboarding wizard (A2) and sales material. In A2 only restaurant types are offered for now (founder D3); bar and coffee icons are kept for later. Icons are SVG files, never an icon font, and always come with a word |

## 6. Components

Every screen uses the same components (`src/components/ui.tsx` and the files in §10.3). The Figma library mirrors these names exactly:

| Figma component | Code | Variants in Figma | Product notes |
|---|---|---|---|
| `Button` | `Button` | `primary` · `secondary` · `quiet` · `danger` × `default` · `hover` · `pressed` · `focus` · `disabled` | Primary = Forest / Off-white (dark: Sage / Charcoal) |
| `LinkButton` | `primaryLinkClass` | default · focus | Navigation dressed as the primary |
| `TextLink` | `linkClass` | default · focus | Forest, underlined |
| `Field` | `Field` + `TextInput` / `Select` | empty · filled · focus · error · disabled; with/without hint | Label `costi/label`, hint `costi/meta` |
| `PinPad` | `pin/pin-pad.tsx` | idle · digits 1–4 · error · sending | Keys ≥ 44 px; see the sign-in spec |
| `Checkbox` | `Checkbox` | off · on · focus | Whole row is the target |
| `ErrorAlert` | `ErrorAlert` | one | `role="alert"`, next to what failed |
| `SuccessNote` | `SuccessNote` | one | `role="status"` when announced |
| `Badge` | `Badge` | neutral · info · warning · success · danger · highlight | Dot + word, never colour alone |
| `Card` | `Card` | plain · with Coral top edge (sign-in card) | Coral edge is decorative (4 px) |
| `HeaderBand` | `HeaderBand` | product (Forest + Coral rule, "Costì") · venue (venue layer: accent fill, venue name or logo) | §9 |
| `ProductLogo` | `ProductLogo` | light · reversed | Placeholder art until BRAND-1 |
| `Heading` / `SubHeading` | `Heading` / `SubHeading` | – | One h1 per screen |

Each component is drawn at 360 px wide in light and dark. Variables in Figma are named after the tokens (`color/paper`, `color/accent`, …);
see §8 for how the Starter plan splits the modes and §10 for the code names.

## 7. Do and don't

**Do:** one Forest primary per screen; Coral only as accent; status always with a word; check every design at 360 × 740 in light and dark;
show the venue's name (or logo) in the band inside the venue and "Costì" on sign-in and the console; mark new Italian wording **(da approvare)**.

**Don't:** Coral text on light surfaces, white on Coral, Coral on Sage; Montserrat for body, labels or buttons; Montserrat 700; italic;
a venue colour anywhere but the band and its rule (§9); a second theme; new token names or hex values outside the tokens; images other
than the logo files; HACCP, traceability or lot-tracking promises (Phase 2, not built: brand.md "Claims"); `www.costi.app` (not verified).

## 8. Figma file

- File: [**"Costì — design system"**](https://www.figma.com/design/4QuajvzZM0J4lSBCOm5Q02) (created 2026-11-14). The Starter plan allows 3 pages,
  so the planned six are folded into three: **Library** (frames `Cover`, `Foundations`, `Components · Costì light`) · **Product screens
  (Costì)** · **Venue screens (osteria theme)**. `Archive` is not needed yet.
- **Variables.** The Starter plan allows **one mode per collection**, so the four looks are four collections with the same 25 names
  (`color/paper` … `color/info-bg`, Web code syntax `var(--color-…)`): `color · Costì light`, `color · Costì dark`, `color · Osteria light`,
  `color · Osteria dark`; plus `size` (gutter, rhythm, field gap, label gap, radii, `size/tap` 44, column 448, focus stroke 3). Values copied
  from §11 and `THEMES`. On a Professional plan these fold back into one collection with four modes, as §6 intended; nothing else changes.
- **Text styles** `costi/*` (Montserrat 600, Inter 400/700) and `osteria/*` (Bodoni Moda 600, Figtree 400/700), the §3 ramp; effect style
  `elevation/card`.
- **Components** are bound to `Costì light`. A screen in another look uses the same instances re-bound to that look's collection and text
  styles (the designer's script does it), which mirrors the scope attribute in code. Built: Button (4 variants × 5 states), LinkButton,
  TextLink, Badge (6 tones), Heading, SubHeading, Card (plain, Coral edge), Field (5 states, hint on/off), Checkbox, ErrorAlert, SuccessNote,
  WarningNote, InfoNotice, PinPad (idle, filled, error, sending), HeaderBand (product, venue), ProductLogo (placeholder, light and reversed),
  NavPill, BottomTabs, Tabs, LedgerRow (optional badge), BackLink, DayPicker, FactRow.
- **Out of date in Figma:** the `HeaderBand · product` component still shows the venue's name; it changes to "Costì" when Figma
  calls are available again (founder decision 2026-11-14, §1).
- **Not yet in Figma:** dark previews of the components (§6 asks for both), the product screens (sign-in, device) and the remaining venue
  screens; blocked by the Starter plan's monthly MCP call limit (2026-11-14).
- Screens are named `<route> · <state> · <look>`, at 360 px wide (phone), with a caption above each frame naming its spec section.

## 9. The venue layer: what a venue may set

A venue (tenant) may set **exactly three things**. Nothing else is configurable: not fonts, not text, action, focus or status colours,
not radii or spacing.

| Setting | Token(s) it sets | Rule | Osteria Dei Rossi (first configuration) |
|---|---|---|---|
| **Name** | band wordmark text (`venue.name`) | 1–40 characters; shown in Montserrat 600 caps in the band (CSS caps; the real name is read aloud) | "Osteria Dei Rossi" |
| **Logo** (optional) | band image | SVG or PNG, shown at 28 px high in the band, `alt` = the venue's name; it replaces the name in the band, never both; on the band colour it must keep ≥ 3:1 against the band (the uploader checks the dominant colour or asks for a light/dark file) | none (the osteria logo is not an approved fact: `docs/client-facts.md`); the name shows |
| **Accent colour** | `--color-band` (both modes) and the derived `--color-band-ink` | one hex value. `band-ink` = Off-white `#F7F8F6` or Charcoal `#1F2933`, whichever contrasts more; **refused** if neither reaches **4.5:1**. The 2 px rule under the band stays Costì Coral (`gold`, unchanged, so the h1 rules stay Coral too); the accent is **also refused** if Coral on it is below **3:1**. The same accent in light and dark | `#1C4130` (approved green): band-ink Off-white **10.67:1**; Coral rule **4.43:1** |

- **Where the accent appears:** the header band (fill), its rule, and the band's focus ring (= `band-ink`). Nowhere else: primary actions
  stay Costì Forest (`accent`, Sage in dark), so "green = act" and every tested pair stay the same in every venue.
- **Validation lives in code**, not in the editor's judgement: one pure function `venueLayer(accentHex)` returns `{band, bandInk}` or a
  refusal code (`band_ink_contrast`, `rule_contrast`), with a unit test for each rule. No new token name: the layer re-values two existing
  ones. The osteria's values are a fixture of that test.
- **Where it is set:** by the owner in the onboarding wizard (A2/SP7) or DigiAlto in the console (later); until SP9, tenant #1's values are
  one constant (`VENUE_LAYER_DEFAULT`) in `tokens.ts`.
- **Guests:** `/prenota` shows the venue layer and no Costì name or logo.

## 10. Code mapping (Figma → code, 1:1)

### 10.1 Colour variables

Every Figma variable `color/<token>` is the CSS custom property **`--color-<token>`** (Tailwind `bg-<token>`, `text-<token>`,
`border-<token>`, …), with the values of **`PRODUCT_THEMES.light` / `.dark`** (`tokens.ts`; `ui-foundation.md` §11). The 25 names are the
existing `COLOR_TOKENS` list; no name is added or renamed.

| Figma collection (Starter: one mode each) | Code |
|---|---|
| `color · Costì light` | `PRODUCT_THEMES.light` → the `:root` light values (after §11 step 9; before it, the `data-brand="costi"` block) |
| `color · Costì dark` | `PRODUCT_THEMES.dark` → the `prefers-color-scheme: dark` block |
| `color · Osteria light` / `color · Osteria dark` | **retired** (old theme). In Figma they become one small collection `venue · Osteria Dei Rossi` with `band`, `band-ink`, `rule` only (updated when Figma calls return) |

### 10.2 Size variables, text styles, effect

| Figma | Code |
|---|---|
| `space/gutter` 16 | `px-4` (page gutter) |
| `space/field-gap` 16 · `space/rhythm` 24 · `space/inline` 8 · `space/label-gap` 6 | `gap-4` · `gap-6` · `gap-2` · `gap-1.5` |
| `radius/control` 8 · `radius/card` 12 · `radius/full` | `rounded-lg` · `rounded-card` (`--radius-card`) · `rounded-full` |
| `size/tap` 44 · (P3) tap-comfort 52 | `--spacing-tap` (`min-h-tap`) · `--spacing-tap-comfort` (`min-h-tap-comfort`) |
| `size/column` 448 | `max-w-md` |
| `stroke/focus` 3 | `:focus-visible { outline: 3px solid var(--color-focus); outline-offset: 2px }` (globals.css) |
| `costi/display` 40 | sign-in h1: `font-display text-[2.5rem] leading-none font-semibold tracking-[-0.01em]` (code wins over Figma's 44 line height) |
| `costi/title` 34/37 | `Heading` (`font-display text-[2.125rem] leading-[1.08] font-semibold`) |
| `costi/section` 24/30 | `SubHeading` (`font-display text-[1.5rem] leading-tight font-semibold`) |
| `costi/wordmark` 21, caps, +0.1 em | `BrandWordmark` / `ProductBrandLink` classes (`text-[1.3125rem] tracking-[0.1em] uppercase font-semibold`) |
| `costi/body` 16/24 | `font-sans text-base` (Inter 400) |
| `costi/label` 16/22 · `costi/label-sm` 15/20 | `font-bold text-base` · `font-bold text-[0.9375rem]` (Inter 700) |
| `costi/meta` 14/20 | `text-sm text-ink-muted` |
| `costi/num` | `.num` (`tabular-nums`) |
| `osteria/*` text styles | **retired** with the osteria theme |
| `elevation/card` | `Card`'s shadow classes (code is the reference; Figma approximates it) |
| Fonts | `--font-display` → Montserrat 600 (`--font-product-display`), `--font-sans` → Inter (`--font-product-body`); Bodoni Moda and Figtree files deleted at §11 step 9 |

### 10.3 Components (25 in the Figma library)

| Figma component | Code | Status |
|---|---|---|
| Button (4 × 5) | `Button` (`ui.tsx`), `comfort` prop for tap-comfort | exists |
| LinkButton | `primaryLinkClass` (`ui.tsx`) | exists |
| TextLink | `linkClass` (`ui.tsx`) | exists |
| Badge (6 tones) | `Badge` (`ui.tsx`) + `RecommendedBadge` (`brand.tsx`) for `highlight` | exists; `highlight` → **new tone** in `Badge` (fold `RecommendedBadge` into it) |
| Heading · SubHeading | `Heading`, `SubHeading` (`ui.tsx`) | exists |
| Card (plain, Coral edge) | `Card` (`ui.tsx`); Coral edge = the sign-in card's class | exists; Coral edge → **new** `Card` prop `edge` |
| Field (5 states, hint) | `Field` + `TextInput` / `Select` (`ui.tsx`) | exists |
| Checkbox | `Checkbox` (`ui.tsx`) | exists |
| ErrorAlert · SuccessNote · WarningNote | `ErrorAlert`, `SuccessNote`, `warningNoteClass` (`ui.tsx`) | exists |
| InfoNotice | — | **new** (`NOTE` + `info` / `info-bg`, `role="status"`) |
| PinPad (4 states) | `src/app/(public)/pin/pin-pad.tsx` | exists |
| HeaderBand · product | `HeaderBand` (`header-band.tsx`) + `ProductBrandLink` (`brand.tsx`) | exists |
| HeaderBand · venue | `HeaderBand` + `BrandLink` / `BrandTitle` (`brand.tsx`) | exists; logo slot and accent from the venue layer → **change** (§9) |
| ProductLogo · light · reversed | `ProductLogo` (`product-scope.tsx`) | exists (placeholder art) |
| — (not in Figma) | `BrandMark` (`brand.tsx`, the osteria's gold diamond in the band) | **retired**: the venue logo slot (§9) replaces it |
| NavPill | `pillClass` (`nav/nav-classes.ts`) via `SectionNavView` | exists |
| BottomTabs | `BottomTabsView` (`nav/bottom-tabs.tsx`), `tabClass` | exists |
| Tabs (segmented) | `course-tabs.tsx` and the comanda's view tabs (inline) | **new** shared `SegmentedControl` (W-a ink fill, `role="tablist"`) |
| LedgerRow | `LedgerList` + `LedgerRow` (`ui.tsx`) | exists; title/meta/trailing-badge layout → **new** props |
| BackLink | `BackLink` (`back-link.tsx`) | exists |
| DayPicker | `src/app/(owner)/chiusura/day-picker.tsx` | exists; **move** to `src/components` (P2-2 reuses it) |
| FactRow | — (each page writes its own `dl`) | **new** `FactList` / `FactRow` |

## 11. Re-skin order

**How:** the switch already exists. A page takes the Costì values when a `data-brand="costi"` element is on it (`globals.css`,
`:root:has([data-brand="costi"])`). Split `ProductScope` into **`CostiTheme`** (the attribute only) and `ProductLogo`, and add `CostiTheme`
to one route group's layout per step, with the venue layer (§9) applied to the band. Each step is one small PR: layout change, fixes for
that group's screens (mainly Bodoni-sized headings and hard-coded cream or black), and screenshots at 360 × 740 light and dark plus the
1280 px layout where one exists.

| Step | Screens | Why this place |
|---|---|---|
| 0 | `venueLayer()` + `VENUE_LAYER_DEFAULT`, `CostiTheme`, new components of §10.3 (InfoNotice, SegmentedControl, FactRow, Badge `highlight`, Card `edge`) | Everything the steps below need |
| 1 | **Sala**: `/tavoli`, `/tavoli/comanda`, conto | Most used (every waiter, every service); P3 just shipped there |
| 2 | **Cucina**: `/cucina` (kitchen board, incl. high contrast), `/produzione`, `/riordino`, `/margini` | Used all service; re-run the high-contrast pairs (`HIGH_CONTRAST_PAIRS`) against Costì values |
| 3 | **Home** (owner and chef), `/spingere` | First screen of every day |
| 4 | **Fatture**: list, upload, revisione | Weekly, money; P2-7 lands here |
| 5 | **Magazzino**, conteggi, `/tracciabilita` | Daily for the chef; P2-2 lands here |
| 6 | **Chiusura**, **Prenotazioni** (staff side), **Report** | Daily close and bookings |
| 7 | Gestione and Anagrafica (ricette, costi, fornitori, ingredienti, personale, impostazioni), **Registro** | Less frequent, many forms |
| 8 | Guest `/prenota/<slug>` and guest e-mails (venue layer, no Costì name) | Guests last: least staff impact, needs SP9 for other venues |
| 9 | Make Costì the `:root` default; delete `THEMES`, the osteria `globals.css` blocks, Bodoni Moda and Figtree files and their tests; `CostiTheme` becomes a no-op and is removed | One theme left |

**Guards per step:** the existing contrast tests run on `PRODUCT_THEMES` (already green); a source test lists the route groups not yet
re-skinned and shrinks with each step (so nobody re-skins out of order by accident); the waiter payload and P3 e2e stay green; no new
token names (§10.1).

## 12. Open questions for the founder

| # | Question | Recommended default |
|---|---|---|
| Q-DS1 | Coral button (Charcoal text): marketing and sales surfaces only, never in the app? | **Yes**: in the app the primary stays Forest |
| Q-DS2 | Does any product surface say "by DigiAlto" (sign-in footer, e-mail footer, app store listing)? Today `ui-foundation.md` §7 says the app shows no DigiAlto name or logo | **No DigiAlto name in the app**; the product is Costì. Sales material may say it |
| Q-DS3 | Logo clear space and minimum size | Set from your vector files when they arrive (BRAND-1) |
| Q-DS4 | Use the chef's-hat pattern in the app (sign-in background, empty states)? | **Not yet**: only after you approve an SVG drawing of it |
