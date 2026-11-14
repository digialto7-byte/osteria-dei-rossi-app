# Costì design system (product surfaces)

- **Status:** draft for founder approval · **Author:** UX/UI designer · **Date:** 2026-11-14
- **Sources (the only ones used):** DigiAlto-Ops `knowledge/agency/products/costi/brand.md` (approved 2026-11-13), ADR-042,
  `docs/design/ui-foundation.md` §1–§7 and §11, `docs/plans/2026-11-13-costi-product-brand.md`, `docs/plans/2026-11-13-ux-strategy.md` §6.
- **Authority.** The token **values** live in code (`PRODUCT_THEMES` in `src/lib/design/tokens.ts`) and in `ui-foundation.md` §11, which a
  test keeps equal to the code. This document does not repeat the value tables; it says **how to use them** on product screens and how
  the Figma library is organised. If this file and §11 ever disagree, §11 wins.
- **Italian wording.** Strings already in `src/lib/i18n/messages/it.ts` are quoted as they are. Any new Italian product wording in this
  folder is marked **(da approvare)** until the copywriter drafts it and the founder approves it (brand.md, "Voice").

## 1. Where Costì applies, and where the venue does

One rule decides every screen: **the product speaks on product surfaces; the venue speaks on venue surfaces** (ADR-042, plan §3.1).

| Surface | Look | Name in the page | Name in the band |
|---|---|---|---|
| Sign-in: `/login` (password, e-mail code, PIN), `/login/codice`, `/login/attiva-codice`, `/login/offerta-codice`; `/pin` → `/login` | Costì | Costì logo + intro | Venue (FD34, Q-CB2) |
| Device enrolment `/dispositivo` | Costì | Costì logo | Venue |
| Staff sign-in e-mail | Costì (inline colours) | Costì | n/a |
| Installed app: icon, splash, manifest; favicon; browser tab title on staff pages | Costì | Costì | n/a |
| Future: onboarding wizard for a new venue (A2), DigiAlto console (SP3), sales/demo pages | Costì | Costì | to design (§8) |
| Home, Sala, Cucina, Gestione, Anagrafica, Registro, every signed-in screen | **Venue** (osteria theme) | Venue | Venue |
| Guest booking `/prenota/<slug>`, guest e-mails; tab title on `/prenota/*` | **Venue** | Venue | Venue (no link) |

**Why:** guests book the osteria, not Costì (lead decision Q-CB6, variant VD); staff work inside their venue all day, and the product
only introduces itself at the door (sign-in, device, install).

**How it is switched (for the builder, already built):** a page gets the Costì look only by living under a layout that renders
`<ProductScope>` (`data-brand="costi"`). A venue page must never render it (source and e2e guards). Designs must therefore never mix
the two looks on one screen.

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
| `costi/wordmark` | Montserrat 600, caps, +0.1 em | 21 / 21 | Band wordmark (the venue's name on product pages) |
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
| **Chef's-hat pattern** (Sage outline, Coral stroke accent) | Decorative only, `aria-hidden`; allowed as a band or empty-state background on product surfaces at low density. Never behind text that must be read; never on venue screens. Not in the app yet: needs an SVG asset (svg-designer) and founder approval of the drawing (Q-DS4) |
| **Venue-type line icons** (cloche, cocktail glass, cutlery, wine, burger, coffee) | For the onboarding wizard (A2) and sales material. In A2 only restaurant types are offered for now (founder D3); bar and coffee icons are kept for later. Icons are SVG files, never an icon font, and always come with a word |

## 6. Components on product surfaces

Product screens use the **same components** as the venue (`src/components/ui.tsx`), re-coloured by the scope. Nothing product-specific is
added to the code. The Figma library mirrors these names exactly:

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
| `HeaderBand` | `HeaderBand` | product (Forest + Coral rule) · venue (osteria) | On product pages it still shows the **venue** name |
| `ProductLogo` | `ProductLogo` | light · reversed | Placeholder art until BRAND-1 |
| `Heading` / `SubHeading` | `Heading` / `SubHeading` | – | One h1 per screen |

Each component is drawn at 360 px wide in light and dark. Variables in Figma are named after the tokens (`color/paper`, `color/accent`, …)
with two modes, **Costì light** and **Costì dark**, plus the same collection's **Osteria light / dark** modes so a venue screen can be
previewed by switching mode, exactly as the scope attribute does in code.

## 7. Do and don't (product)

**Do:** one Forest primary per screen; Coral only as accent; status always with a word; check every design at 360 × 740 in light and dark;
use the venue's name in the band; mark new Italian wording **(da approvare)**.

**Don't:** Coral text on light surfaces, white on Coral, Coral on Sage; Montserrat for body, labels or buttons; Montserrat 700; italic;
the Costì look on a venue screen or the venue look on a product screen; new token names or hex values outside the tokens; images other
than the logo files; HACCP, traceability or lot-tracking promises (Phase 2, not built: brand.md "Claims"); `www.costi.app` (not verified).

## 8. Figma file

- File: **"Costì — design system"** (link added to `docs/ux/README.md` when created). Pages: `Cover` · `Foundations` (variables, text
  styles, contrast pairs) · `Components` · `Product screens` · `Venue screens (osteria theme)` · `Archive`.
- Screens are named `<route> · <state> · <mode>`, e.g. `/login · PIN · light`, at 360 × 740 (phone) and 1280 × 800 (laptop) when a laptop
  layout differs.
- Every screen frame links back to its spec in `docs/ux/` in its description.

## 9. Open questions for the founder

| # | Question | Recommended default |
|---|---|---|
| Q-DS1 | Coral button (Charcoal text): marketing and sales surfaces only, never in the app? | **Yes**: in the app the primary stays Forest |
| Q-DS2 | Does any product surface say "by DigiAlto" (sign-in footer, e-mail footer, app store listing)? Today `ui-foundation.md` §7 says the app shows no DigiAlto name or logo | **No DigiAlto name in the app**; the product is Costì. Sales material may say it |
| Q-DS3 | Logo clear space and minimum size | Set from your vector files when they arrive (BRAND-1) |
| Q-DS4 | Use the chef's-hat pattern in the app (sign-in background, empty states)? | **Not yet**: only after you approve an SVG drawing of it |
