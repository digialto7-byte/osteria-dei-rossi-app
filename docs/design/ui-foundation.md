# UI foundation: Osteria Dei Rossi

Status: adopted on `feat/ui-foundation` (2026-10-22). This is the house style for every screen of
the app.

**Source of the brand.** The founder approved the trading name "Osteria Dei Rossi", eight brand
colours and the two fonts on 2026-10-22; they are listed in `docs/client-facts.md`, and nothing
else in this document is a client fact. Every other colour is a **derived UI shade** (a tint,
hover or on-colour chosen for contrast, with a formula where it is a blend of approved colours).
The recommendation badge ("Consigliato") and the logo slot are generic UI motifs of the app, not
client wording or artwork. The app shows no DigiAlto name or logo.

All colours live in two files: `src/app/globals.css` (runtime) and `src/lib/design/tokens.ts`
(tests). Components and screens use token utilities only. A brand change is a token change.

## 1. Direction

The look is cream paper, a deep green, black type, a high-contrast Bodoni for names, and gold
rules and badges. The app turns that palette into a working tool, used on a phone by an owner or
chef, often mid-service.

Four principles, in priority order:

1. **Legible at arm's length.** Body text is 16 px Figtree. Every text pair is AA in both themes,
   controls are 44 px or more, and figures line up.
2. **One green action.** The brand green is the primary action (cream text on green). Everything
   else is black or soft-green ink on cream. Colour that carries meaning (status) always comes
   with a word.
3. **Gold is jewellery, not text.** Gold and yellow mark things: the header rule, the rule under
   a page title, the focus ring (a deeper gold in light), the logo slot and the "Consigliato"
   badge. They never colour text on cream. They fail AA there, and a test enforces it.
4. **Printed menu, not dashboard.** Bodoni names a page; Figtree does the work. Lists are rows
   ruled by hairlines. Cards are kept for forms and fact sheets. The only texture is the grain on
   the green header band; content surfaces stay plain for legibility.

### Light or dark

**Light is the primary theme**: cream, green and black. Dark follows the device
setting (`prefers-color-scheme`). It uses the brand black with cream ink, plus a sage green,
lightened so that it stays AA on black. Neither theme is forced. A chef who keeps the
phone in dark mode for an evening service gets dark, and everyone else gets the brand as
printed. There is no in-app theme switch yet. If one is added, it sets `data-theme` on `<html>`,
and the dark block in `globals.css` gains a `:root[data-theme="dark"]` selector.

## 2. Colour tokens

The runtime source is the Tailwind v4 `@theme` block in `src/app/globals.css`, plus the
`@media (prefers-color-scheme: dark)` override on `:root`. `src/lib/design/tokens.ts` mirrors the
values (and the approved palette as `BRAND`, with the blends in `DERIVED`) for the tests.
`tests/lib/design/tokens.test.ts` fails in these cases:

- the two files differ;
- a pair below drops under its AA minimum in either theme;
- the light theme stops being the approved cream, green, black and soft;
- a `DERIVED` literal stops matching its `mix()` formula;
- a component uses `gold` or `highlight` as a text colour.

Utility names follow the token: `bg-paper`, `text-ink-muted`, `border-rule`,
`bg-accent text-on-accent`, `bg-highlight text-on-highlight`, and so on.

| Token | Light | Dark | Role |
|---|---|---|---|
| `paper` | `#FFFADF` | `#0F0F0D` | Page background (cream / black) |
| `surface` | `#FFFDF2` | `#1A1A16` | Cards, inputs, secondary buttons |
| `sunk` | `#F8EFC6` | `#25241F` | Hover fill, neutral badge, chosen-file chip (cream-deep) |
| `ink` | `#0F0F0D` | `#FFFADF` | Body text, current nav tab fill (black / cream) |
| `ink-muted` | `#4D5B45` | `#B7B4A0` | Hints, secondary row text, `dt` labels (soft / dark: `mix(cream, black, 0.3)`) |
| `rule` | `#EAD4A3` | `#33322B` | Hairlines, card borders; decorative. Light: `mix(cream-deep, gold, 0.3)` |
| `rule-strong` | `#857A57` | `#7A7462` | Input borders (a UI boundary, ≥ 3:1) |
| `band` | `#1C4130` | `#16301F` | Header band (green) |
| `band-ink` | `#FFFADF` | `#FFFADF` | Wordmark on the band |
| `gold` | `#C89550` | `#C89550` | Rules, logo slot. Accent only |
| `highlight` | `#FFB028` | `#FFB028` | "Consigliato" badge fill, logo slot. Accent only |
| `on-highlight` | `#0F0F0D` | `#0F0F0D` | Text on the yellow badge |
| `accent` | `#1C4130` | `#8CB89A` | Primary button fill (green; sage in dark) |
| `accent-hover` | `#122C20` | `#A6CBB1` | Primary button hover |
| `on-accent` | `#FFFADF` | `#0F0F0D` | Label on the primary button |
| `accent-ink` | `#1C4130` | `#A9D1B4` | Green as text: links, quiet buttons |
| `focus` | `#8A5F22` | `#C89550` | Focus ring (deep gold in light, brand gold in dark) |
| `success` / `success-bg` | `#2D6435` / `#E2ECD9` | `#A3D4A9` / `#1B2C1D` | Confirmations, "Approvata" |
| `warning` / `warning-bg` | `#74480A` / `#F5E5C3` | `#EBC57E` / `#302511` | "Da controllare", "Duplicata" |
| `danger` / `danger-bg` | `#9A2A1D` / `#F6DDD5` | `#F4A694` / `#391A12` | Errors, "Rifiutata", "Lettura non riuscita" |
| `info` / `info-bg` | `#1E5470` / `#DCE8EE` | `#A1CBE2` / `#14252F` | "In lettura" |

Approved brand colours (`docs/client-facts.md`): cream `#FFFADF`, cream-deep `#F8EFC6`, green
`#1C4130`, gold `#C89550`, olive `#7D9550`, soft `#4D5B45`, black `#0F0F0D`, yellow `#FFB028`.
Every other value in the table is a derived UI shade: a tint, hover or on-colour picked to meet
contrast, including `surface` and the whole dark theme apart from black, gold and yellow. Three
are exact blends of approved colours, exported as `DERIVED` in `tokens.ts` with the helper
`mix(a, b, t)` (per-channel linear blend, `t = 0` is `a`):

| Shade | Value | Formula | Contrast |
|---|---|---|---|
| `rule` (light) | `#EAD4A3` | `mix(creamDeep, gold, 0.3)` | decorative hairline, no minimum |
| `ink`, `band-ink` (dark) | `#FFFADF` | cream itself | 18.27 on `paper`, 13.54 on `band` |
| `ink-muted` (dark) | `#B7B4A0` | `mix(cream, black, 0.3)` | 9.18 on `paper`, 8.35 on `surface`, 7.44 on `sunk` |

A test asserts each literal equals its formula. The literals are hard-coded in `THEMES` and
`globals.css`, which a second test keeps in sync.

The approved olive (`#7D9550`) is not used yet: no screen needs a second green. In dark, the brand
green on black would be too dim for a button (1.6:1), so the action turns sage with a black label.

### Contrast ratios (WCAG 2.2, tested)

The minimum is 4.5:1 for text and 3:1 for UI boundaries and focus indicators (SC 1.4.11).

| Foreground | Background | Used for | Min | Light | Dark |
|---|---|---|---|---|---|
| `ink` | `paper` | Body text on the page | 4.5 | 18.27 | 18.27 |
| `ink` | `surface` | Text in cards, inputs, secondary buttons | 4.5 | 18.81 | 16.61 |
| `ink` | `sunk` | Text on hovered rows, tabs and buttons | 4.5 | 16.59 | 14.80 |
| `paper` | `ink` | Current tab in the owner nav | 4.5 | 18.27 | 18.27 |
| `ink-muted` | `paper` | Hints and secondary row text | 4.5 | 6.90 | 9.18 |
| `ink-muted` | `surface` | Hints inside cards | 4.5 | 7.10 | 8.35 |
| `ink-muted` | `sunk` | Neutral status badge | 4.5 | 6.26 | 7.44 |
| `band-ink` | `band` | Wordmark on the header band | 4.5 | 10.82 | 13.54 |
| `on-accent` | `accent` | Primary button label | 4.5 | 10.82 | 8.62 |
| `on-accent` | `accent-hover` | Primary button label, hover | 4.5 | 14.21 | 10.78 |
| `accent-ink` | `paper` | Links and quiet buttons | 4.5 | 10.82 | 11.39 |
| `accent-ink` | `surface` | Links inside cards | 4.5 | 11.14 | 10.36 |
| `accent-ink` | `sunk` | Quiet button, hover | 4.5 | 9.82 | 9.23 |
| `on-highlight` | `highlight` | "Consigliato" badge | 4.5 | 10.50 | 10.50 |
| `success` | `success-bg` | Success notice and badge | 4.5 | 5.77 | 8.81 |
| `warning` | `warning-bg` | Warning badge and extraction notes | 4.5 | 6.31 | 9.17 |
| `danger` | `danger-bg` | Error alert and badge | 4.5 | 5.96 | 8.06 |
| `danger` | `paper` | Per-row import errors on the page | 4.5 | 7.34 | 9.80 |
| `info` | `info-bg` | Info badge | 4.5 | 6.58 | 9.10 |
| `rule-strong` | `surface` | Input border in cards | 3 | 4.18 | 3.74 |
| `rule-strong` | `paper` | Input border on the page | 3 | 4.06 | 4.11 |
| `accent` | `paper` | Primary button shape on the page | 3 | 10.82 | 8.62 |
| `accent` | `surface` | Primary button shape in cards | 3 | 11.14 | 7.84 |
| `ink` | `surface` | Secondary button and file-picker border | 3 | 18.81 | 16.61 |
| `focus` | `paper` | Focus ring on the page | 3 | 5.34 | 7.19 |
| `focus` | `surface` | Focus ring in cards | 3 | 5.50 | 6.54 |
| `gold` | `band` | Gold rule under the wordmark | 3 | 4.26 | 5.33 |

**Accent-only, by measurement:** on cream, gold is 2.54:1 and yellow 1.74:1, so neither may set
text. The tests assert both numbers stay under 4.5 and that no `text-gold` or `text-highlight`
appears in `src/`. The gold rule under a page title is decorative, so it has no minimum. The
tightest required pair is `rule-strong` on `surface` in dark, at 3.74:1. A new combination goes
into `CONTRAST_PAIRS` in `tokens.ts` before it is used.

## 3. Typography

The brand's own faces, loaded with `next/font/google` in `src/app/layout.tsx`. They are
**downloaded at build time and served from `/_next/static/media`**, so the browser never contacts
Google, which matters under GDPR for an EU venue. No npm dependency is added. The build ships six
woff2 files, one per character range (`subsets: ["latin"]` only decides what is preloaded); the
login page downloads exactly **two** of them: Bodoni Moda 600 and Figtree, which is one variable
file that serves both 400 and 700.

| Role | Face | Size / leading | Notes |
|---|---|---|---|
| Wordmark in the header | Bodoni Moda 600, caps | 21 px / 1, +0.1 em | Uppercase by CSS; the text stays "Osteria Dei Rossi" for screen readers |
| Page title (`Heading`, h1) | Bodoni Moda 600 | 34 px / 1.08 | `text-balance`, 48 px gold rule below. Login title is 40 px |
| Section title (`SubHeading`, h2) | Bodoni Moda 600 | 24 px / 1.25 | Also the tenant name on Home |
| Body and controls | Figtree 400 | 16 px / 1.5 | Inputs stay 16 px so iOS does not zoom |
| Labels, row titles, buttons | Figtree 700 | 15–16 px | |
| Hints, meta lines, loading and empty lines | Figtree 400 | 14–16 px | `text-ink-muted`, no italic |
| Amounts, quantities, dates, VAT numbers | Figtree + `.num` | Same as context | `font-variant-numeric: tabular-nums` |

**Why these, and what was dropped.**

- **Bodoni Moda** is the approved display face. Its hairlines break up below about 20 px, so it is
  only used at 21 px or more, and at 600 rather than the 400 regular, whose hairlines are too thin
  for a phone at arm's length. The comparison is in `screenshots/display-font-bodoni.png`: 600
  and 700, with and without a small optical size, on the band, on cream and on black. 700 was a
  touch heavy against Figtree bold labels, and the optical-size axis made no visible difference
  at these sizes. So one static weight is loaded.
- **Figtree** is the approved body face: open, with clear figures and a distinct `1/l/I`.
- **Source Serif 4** is not loaded and is not an approved client fact. It has no role in the
  current screens. It is the candidate for long dish descriptions when the menu screens arrive; add it then, at 400 only.
- **Instrument Serif and Atkinson Hyperlegible** were removed, together with every italic and
  bold-italic face. The round-1 review found the italics preloaded but unused. `Muted` and the
  upload's "Caricamento in corso…" line are no longer italic. Do not reintroduce `italic`: no
  italic face is loaded, so the browser would fake one.
- An earlier draft of this round tried varsity faces (Graduate, Staatliches, Big Shoulders,
  Alfa Slab One) after a description of the logo. It was dropped once the approved fonts were
  known.

Fallbacks are Next's metric-adjusted "… Fallback" faces, then Didot/Georgia for display and
`ui-sans-serif` for body.

**Guards:**

- `tests/lib/design/fonts.test.ts` checks four things: no source file names a Google Fonts host,
  the layout uses `next/font` with Bodoni Moda and Figtree, no retired family or `"italic"` is
  loaded, and Bodoni is loaded at the single weight 600.
- `e2e/fonts.spec.ts` checks the build output and a real page load:
  - it scans `.next/static` and `.next/server/app` for Google hosts;
  - on `/login`, every `.woff2` request goes to `/_next/static/media` on the app's own origin
    and gets a **200** response;
  - `document.fonts` has a **loaded** face for each family in use, and the heading and body
    actually compute to Bodoni Moda and Figtree.

When the nonce-based CSP lands (M25), keep `font-src 'self'` and `style-src 'self'` plus the
nonce. Nothing here needs a third-party origin, `data:` URIs or inline `style` attributes. The
band grain and the stagger are pure CSS.

## 4. Space, shape, atmosphere

- **Column:** `max-w-md`, a 16 px side gutter and a 24 px vertical rhythm (`gap-6`). Inside a
  card, fields sit 16 px apart and a label sits 6 px above its control.
- **Radius:** 8 px for controls, 12 px for cards (`rounded-card`), full for pills and badges.
- **Header band:** full-width brand green, a 2 px gold rule at the bottom, the logo slot and the
  wordmark. The browser `theme-color` matches the band, so on a phone the status bar continues
  it.
- **Texture:** only on the band, as two offset speck grids in CSS (`.band` in `globals.css`), each
  under 7 % ink and 18 % black. That is the "printed cover" grain. It sits behind
  `band-ink` text, which is far over AA (10.8:1). Content surfaces have no texture.
- **Rules:** a 1 px `rule` hairline between rows. A 48 × 2 px gold rule under each page title,
  as a printed-menu ornament. A 4 px gold edge along the top of the login card.
- **Depth:** cards get a 1 px border plus a soft long shadow. The primary button gets a 1 px
  bottom shade. There are no other shadows.

## 5. Motion

- **One reveal:** direct children of `<main>` (`.reveal`) and ledger rows (`.ledger`) rise 6 px
  and fade in over 420 ms with `cubic-bezier(0.22, 1, 0.36, 1)`, staggered 40 ms and capped at
  280 ms. Alerts and notices use the same rise when they appear.
- **Fill mode `backwards`** (fixed in review round 1). With `both`, the end keyframe kept
  `transform` pinned on every revealed element and beat `active:translate-y-px` on a button that
  is a direct child. With `backwards`, the start state still applies during the stagger delay,
  and the element lets go of `transform` when the rise ends. A test keeps it `backwards`.
- **States:** hover fills `sunk` on rows, tabs and secondary buttons and darkens the primary
  button (lightens in dark). Press nudges buttons down 1 px. Transitions last 150 ms.
- **Focus:** a 3 px `focus` outline with a 2 px offset on every focusable element
  (`:focus-visible`). The file picker draws it on its wrapper (§6). Never remove it.
- **Reduced motion:** the `prefers-reduced-motion: reduce` block cuts every animation and
  transition to 0.01 ms *and zeroes animation delays*. A test guards that block.

## 6. Components

All existing props and accessible names are unchanged. Each control is labelled and at least
44 px tall (`min-h-tap`).

`src/components/ui.tsx`:

| Component | Rule |
|---|---|
| `Field` | A wrapping `<label>`: bold label, the control, then an optional muted hint. Always use it, so `getByLabel` keeps working |
| `TextInput` / `Select` | `surface` fill, `rule-strong` border, 8 px radius. `Select` draws its chevron in CSS |
| `FilePicker` | See below. Use it inside `Field` instead of a bare `<input type="file">` |
| `Checkbox` | 20 px native box tinted with `accent-color`. The whole label row is the 44 px target |
| `Button` `primary` | Green fill, cream label. One per form or screen: the action that moves the work forward |
| `Button` `secondary` | Black 1.5 px outline on `surface`. Row actions ("Disattiva", "Rendi preferito") and "Esci" |
| `Button` `quiet` | Green text, no border. Low-stakes actions next to a primary ("Annulla") |
| `Button` `danger` | `danger` text and bar on `danger-bg` (a tested pair). A removal the person asked for ("Rimuovi" on an order line). Never the only way to see a state |
| `primaryLinkClass` | A link dressed as the primary button, for navigation that is the screen's one forward action ("Prendi la comanda") |
| `linkClass` | Navigation set as text: bold `accent-ink`, underlined, 44 px tall |
| `ErrorAlert` | `role="alert"`, a `danger` left bar on `danger-bg`. One per failure, next to what failed |
| `SuccessNote` | A `success` left bar on `success-bg`. The caller passes `role="status"` when it must be announced. One `status` per screen |
| `Heading` / `SubHeading` | Bodoni h1 (with the gold rule) and h2. One h1 per screen |
| `Card` | A raised sheet for a form or a fact sheet (`dl`). At most two per screen |
| `LedgerList` / `LedgerRow` | `ul`/`li` with hairlines and the staggered rise |
| `Muted` | Muted line for "Caricamento…" and empty states |
| `Badge` | Pill with a dot and a word, in one of the status tones (neutral, info, warning, success, danger). The word always says the state; `StatusBadge` and the review line badges use it |

**`FilePicker`.** The browser's own button reads "Choose File / No file chosen" in English and
cannot be translated, so the component replaces it with an overlay:

- the real `<input type="file">` stays inside `Field`'s `<label>` (no nested label), so
  `getByLabel(...).setInputFiles` and the accessible name ("Carica PDF o foto" plus the hint) are
  exactly what they were;
- the input is `opacity-0`, absolutely positioned over a drawn 44 px button reading "Scegli file",
  or "Scatta foto" for the camera input. It covers the wrapper's border box, so it measures 44 px
  in `expectPhoneFriendly`. It is not `sr-only`;
- the drawn label and the status line are `aria-hidden`, so they do not join the accessible name.
  The status reaches assistive tech as the input's `aria-describedby`;
- the status reads "Nessun file scelto", or "File scelto: …" as a `sunk` chip;
- the focus ring is drawn on the wrapper with `has-[:focus-visible]`, and the hover fill with
  `has-[:hover]`.

It is used on `/fatture` (camera and file) and `/anagrafiche/importa`. On `/fatture` the two
pickers share one chosen file: the one that holds it shows the chip, the other goes back to
"Nessun file scelto". `tests/components/file-picker.test.ts` renders it and checks the
structure.

`src/components/brand.tsx`:

| Component | Rule |
|---|---|
| `BrandMark` | **The logo slot**, left of the wordmark: a 24 px gold lozenge with a yellow centre, `aria-hidden`, `data-slot="brand-mark"`. A placeholder for the logo (TODO §9) |
| `RecommendedBadge` | "Consigliato" / "Recommended": a generic badge, not client wording. A yellow pill with black bold text (10.5:1) and a small lozenge. For the menu and dish screens; never colour alone |

Elsewhere:

| Component | Rule |
|---|---|
| `StatusBadge` (`fatture/status-badge.tsx`) | Pill with a dot and the Italian label. The tone maps from the status. Colour never stands alone |
| `OwnerNav` (`(owner)/owner-nav.tsx`) | Pills that wrap onto two lines at 360 px. The current tab is ink-filled with `aria-current="page"`. The matching is `isCurrent` in `src/lib/nav/is-current.ts`, unit-tested: Home only on `/`; a tab on its path, `path/` and anything below; sibling tabs never cross-match; a supplier detail page marks Fornitori |

## 7. Do and don't

**Do**

- take every colour from a token utility; add a token and a contrast pair before you need a new
  colour;
- keep green for the one primary action and links, and gold or yellow for
  marks;
- put `.num` on every amount, quantity, date and code a person compares down a column;
- keep amounts in the `1.234,50 €` format and dates in Europe/Rome;
- check new screens at 360 × 740 in both themes and with reduced motion.

**Don't**

- set text in `gold` or `highlight`, or put small text on yellow other than `on-highlight`;
- set Bodoni below 20 px, or set labels, buttons, amounts or body text in it;
- use `italic` (no italic face is loaded);
- use Tailwind palette colours or hex values in components;
- add images, icon fonts, `data:` URIs, inline `style` attributes or third-party origins (the
  real logo goes in as a self-hosted file, §9);
- remove the focus outline, or use colour alone to carry a status;
- show the DigiAlto name or logo.

## 8. Applying it to the next screens

**M4, invoice review (built):** `/fatture/[id]/revisione` and `/fatture/qualita` follow this. The review page opts into a wide laptop layout with `data-layout="wide"` (only that page widens `<main>` and the header band, `lg:` and up); the document is framed on the left and the lines are on the right, and on a phone the document is a button and the lines stack. Line editors are bordered forms, not `Card`s, so a screen keeps its two-`Card` limit. The original brief was: header facts go in a `Card` with a `dl`. Each extracted line is a
`LedgerRow` with a `.num` meta line. An unmatched line or a price jump gets a `warning` badge with
a word. "Approva" is the one green action and "Rifiuta" is `secondary`. Show one `SuccessNote`
with `role="status"` after approval.

**M5, approval (built):** the approval panel is the second `Card` of the review page, after the lines. It
writes down what the database previewed (the payable in `.num`, the receipts, the blockers as `warning` notes
with a word each and a "Vedi riga" link) and never computes. "Approva fattura" is the one primary button and is
`disabled` while a blocker is left (`aria-describedby` points at the list); "Rifiuta" is `secondary`. Approving
takes two taps: the second step states what is booked and "Non si può annullare." The reject form is a bordered
form (not a `Card`) with an optional reason and the hint "Non inserire dati personali." A decided invoice shows
a `success` or `danger` badge with the Europe/Rome time and person, and one `SuccessNote` with `role="status"`
after an approval. Screenshots of the panel (`approvazione-*.png`) are not taken yet: they need the throwaway
harness below, which is not in the repository.

**Menu and dish screens:** dish names in Bodoni at 21 px or more, prices `.num` at the right edge,
and `RecommendedBadge` on recommended dishes. Descriptions in Figtree; this is where Source Serif 4
may earn its place. Allergens are always words or numbered codes, never colour.

**M6, alerts (built):** `/avvisi` is a list of `LedgerRow`s, one per alert: a `Badge` with a word (`info` "Informazione", `warning` "Attenzione", `critical` as `danger` "Urgente"), the rendered title in bold, the body, and a `.num` meta line in Europe/Rome. The open alert has one 44 px `secondary` "Ho visto"; an acknowledged one shows "Visto il … da …" instead (the chef sees no name that is not their own). Two text filters ("Da vedere", "Tutti") are buttons with `aria-pressed`, the chosen one bold and underlined. The owner also gets one `Card` "Prova degli avvisi" (a labelled checkbox and one `secondary` button; the page has no primary button). A waiter sees one `ErrorAlert`. The text of an alert is rendered on the server per kind and locale; the screen shows strings and never computes, and nothing on it mentions email. "Avvisi" is a tab of `OwnerNav` and a link on the home card for the owner and the chef.

**M7, recipes (built):** `/ricette` is a `LedgerList` of recipes: the name as a link, a neutral `Badge` with the type word ("Lotto", "Piatto", "Sottoricetta"), a `warning` `Badge` "Allergeni da confermare" until every ingredient below is confirmed, and a `.num` meta line "v3 · dal 23/10/2026" (Europe/Rome). Four text filters (`aria-pressed`) and one primary "Nuova ricetta". The detail page has one `Card` fact sheet (`dl`, rows a recipe does not have are left out; the menu price and the target GP% show for owner, admin and chef, never a cost or a margin), an "Allergeni" section in words with a `warning` `Badge` "da confermare" and the names still to confirm, the lines as a `LedgerList` (`.num` "5 kg · resa 1", a `warning` `Badge` "Resa > 1"), and the versions as links. A past version is the same layout, read-only ("Versione 1 di 3 — non modificabile") and says its allergens follow today's data. The form is one `Card`-less form: the lines are bordered rows (not `Card`s), the quantity and yield fields are decimal text, and the chef's form has no price field. After a save the detail opens with one `SuccessNote` `role="status"` ("Versione 2 salvata.") and each warning as plain text. On `/anagrafiche/ingredienti` the allergen cell is words ("Non indicati", "Nessuno", or the list) with the same `warning` `Badge`, and only the owner gets "Conferma allergeni" (a bordered form with 14 labelled checkboxes). "Ricette" is a tab of `OwnerNav` for owner, admin and chef.

**M9, payables (built):** `/pagamenti` is a `LedgerList` of payables for owner and admin: the supplier as a bold link, the amount `.num` at the right edge, a `.num` line "Fattura 123/A del 01/12/2026", a due line from the server's day count ("Scade il 10/12/2026 (tra 7 giorni)", "Scade oggi", "Scaduta da 3 giorni"), a `Badge` with a word for the status (open "Da pagare" neutral, scheduled "Programmata" info, paid "Pagata il …" success, disputed "Contestata" warning) and an extra `danger` `Badge` "Scaduta" when the server says overdue. Three text filters ("Da pagare", "Pagate", "Tutte"; `aria-pressed`), a `.num` totals line for "Da pagare", and "Mostra altri" (`secondary`) for the next page. The detail page has one `Card` fact sheet (`dl`), then a bordered status form that offers only the statuses the server lists in `allowedStatuses` ("Segna come pagata" is the one primary button, with a "Data del pagamento" date field starting at the server's today; "Segna come programmata" and "Segna come contestata" are `secondary`, "Riporta a da pagare" is `quiet`; an optional "Nota" with the hint "Non inserire dati personali."). A paid payable offers only "Annulla pagamento" (`secondary`); the second tap asks for the required "Motivo" and says the payment stays in the history. One `SuccessNote` `role="status"` after a save, and the "Storico" `LedgerList` below. "Pagamenti" is a tab of `OwnerNav` and a link on the home card for owner and admin; a chef or waiter who opens the URL sees one `ErrorAlert`. Nothing on these screens counts days or adds money.

**M8, food cost (built):** `/costi` is the owner's and admin's cost list: a date `Field` "Al giorno" (default today, kept in `?at=`), for the owner only a `Card` "Costi fissi" (figures in a `dl`, or an `info` `Badge` "Non ripartiti" with the sentence that food cost % and GP % stay valid), then a `LedgerList` of plates: the name as a link, a `Badge` with a word per status ("In linea", "Sotto obiettivo", "Costi fissi non ripartiti", "Costo incompleto"), two `.num` lines of figures and, for an incomplete plate, the missing ingredient names as plain text. `/costi/ricette/[key]` is one `Card` of facts and the lines as a `LedgerList` (`.num` "5 kg × 10,00 €/kg ÷ resa 1 = 50,00 €"; a `warning` `Badge` on a line without a price). `/costi/ingredienti` has one 44 px secondary button per row ("Usa ultimo prezzo" / "Usa la media", `aria-describedby` the row name) and "Nessun acquisto" instead of a 0,00 € figure. `/costi/impostazioni` has two `Card` forms (fixed costs: owner only, monthly totals only; calculation rules: owner and admin). `/costi/verifica` takes the chef's sheet as a file or pasted text and lists the plates more than 5 % off, then the rows it could not compare. `/margini` is the chef's list: name, `Badge` ("In linea", "Sotto obiettivo", "Dati incompleti") and a `.num` line "Food cost 18,9 % · GP 81,2 % · obiettivo 70 %"; no euro sign and no cost figure anywhere on it. "Costi" is a tab of `OwnerNav` for owner and admin, "Margini" the chef's tab; the waiter has neither.

**M11, staff PIN login (built):** `/pin` (public, phone first) is "Chi sei?": a `LedgerList` of 44 px buttons, each with the name and a neutral role `Badge` ("Cuoco", "Cameriere"); after a tap, "Ciao, {nome}", one masked numeric `Field` "PIN" (`type="password"`, `inputmode="numeric"`, `maxlength=4`), one primary "Entra" and a secondary "Cambia persona"; the field is cleared after every answer and a wrong PIN is an `ErrorAlert` ("PIN errato. Tentativi rimasti: 2.", "Troppi tentativi. Riprova alle 21:15."). A device that is not enabled sees one `Card` with two links. `/dispositivo` is one `Field` "Codice di abilitazione" and one primary "Abilita"; unknown, used and expired codes read the same. `/personale` (owner and admin) has one `Card` form "Aggiungi persona" (name, role radios, PIN twice) and a `LedgerList` of people: a bold name, `Badge`es with a word (role, "Disattivato", warning "Bloccato fino alle 21:15", info "Accesso con email"), and 44 px actions "Cambia PIN" (an inline bordered form), "Disattiva"/"Riattiva", "Cambia ruolo" (each `aria-describedby` the name). `/dispositivi` has one `Card` form "Nuovo codice", the code shown once in a `Card` (`.num`, large, with "Scade alle 19:17."), a `LedgerList` of devices (label, status `Badge` "Attivo"/"Bloccato"/"Revocato", a `.num` meta line, "Sblocca" only when locked, "Revoca" asking once with the device name) and the pending codes by label and expiry, never the code. No screen shows when a person logged in or out (project Q10); a device shows only its own last use. "Personale" is a tab of `OwnerNav` for owner and admin. Nothing here counts attempts or decides a lock.

**M12, raw stock (built):** `/magazzino` is a `LedgerList` of ingredients for owner, admin and chef: the name as a bold link, the total `.num` at the right edge, a `.num` line per location ("Cella (demo) 10 kg · Freezer (demo) 2,3 kg"), a `danger` `Badge` "Scorta negativa" when the server says so, and a muted line "−1 kg senza lotto: fai un conteggio" for stock booked without a lot. A "Ubicazione" `Select` ("Tutte" plus the locations) is kept in `?location=`; owner and admin also get a text link "Sprechi in €". `/magazzino/[ingredientId]` has one `Card` fact sheet (`dl`), "Lotti (il primo in scadenza in alto)" as a `LedgerList` (code in bold, an expiry `Badge` from the server's state: "Scaduto il …" `danger`, "Scade il …" `warning` within a day and neutral otherwise, "Senza scadenza"; a `.num` detail line; the unlotted bucket is the row "Senza lotto"), two bordered forms (not `Card`s) and the history. "Registra spreco" is the one primary button (quantity with `inputmode="decimal"`, unit, reason, lot defaulting to "Primo in scadenza (consigliato)", location only with two or more locations); "Sposta" is `secondary` and the form is hidden with one location. Each reversible operation has a 44 px `secondary` "Annulla"; the second tap shows "Conferma annullamento" and says the original stays in the history; a reversed operation carries a neutral `Badge` "Annullato". Quantities use the real minus sign (U+2212). **No euro sign appears on these two screens for any role**: the waste in EUR is only on `/magazzino/sprechi` ("Sprechi in €", owner and admin; a `Card` `dl` with "Valore degli sprechi 123,45 €" and, when above zero, "Movimenti senza prezzo", then a list per reason where a line without a price reads "valore non disponibile", never "0,00 €"). A chef or waiter who opens that URL sees one `ErrorAlert`; a waiter sees one `ErrorAlert` on `/magazzino` too. "Magazzino" is a tab of `OwnerNav` and a link on the home card for owner, admin and chef. Nothing on these screens adds a quantity, compares a date or works out a reversible flag.

**M14, batch production (built):** `/produzione` is a `LedgerList` of batches for owner, admin and chef, newest first: the recipe in bold, a `danger` `Badge` "Scaduto" or `warning` `Badge` "In scadenza" from the server's use-by state (nothing for a batch that is fine), the lot code in `.num`, a `.num` line "Prodotto il 23/10/2026, 12:12 · da consumare entro il 26/10/2026, 11:12" (Europe/Rome), a `.num` line "31 porzioni · rimaste 31 · CD" ("tu" for your own batch, "(calcolate 30)" only when the chef changed the portions) and a text link "Etichetta". Owner and admin also see "Costo 53,52 € · 1,73 € a porzione", or "Costo incompleto: manca il prezzo di un ingrediente", never "0,00 €"; **the chef's markup has no euro sign at all**. One primary "Nuova produzione" and "Mostra altri" (`secondary`). `/produzione/nuova` is one page of four bordered sections ("Ricetta", "Quantità prodotta", "Ingredienti usati", "Lotto prodotto", not `Card`s): "Calcola" is `secondary`; each ingredient is a bordered block with the proposal ("Proposto 5,1667 kg", four decimals), the stock per place, "Usato" with `inputmode="decimal"` prefilled with the proposal, the unit, the place only with two or more places and the lot defaulting to "Primo in scadenza (consigliato)"; water and other non-stock ingredients are shown with "Non a magazzino: non viene scaricato" and no fields. "Porzioni" (`inputmode="numeric"`) is prefilled with the computed number and says how it was made; "Registra produzione" is the one primary button, and an error names the ingredient it concerns (`aria-invalid` and its message). The use-by line is the server's preview, never worked out in React. `/produzione/[id]/etichetta` shows the six lines of the label in a narrow black-on-white block (the text to copy by hand; printing is a later phase), right after a production a `SuccessNote` with `role="status"` and one `warning` note per location the production left negative. "Produzione" is a tab of `OwnerNav` and a link on the home card for owner, admin and chef; in the stock history the consumption of a production reads "Produzione" and has no "Annulla".

**M15, batch actions (built):** `/produzione/[id]` is the batch: the recipe as the `Heading`, one `Card` fact sheet (a `dl` with the lot code in `.num`, "Rimaste 6 di 10 porzioni", produced and use-by in Europe/Rome, the location and the maker's initials; a neutral `Badge` "Aperto", "Finito" or "Scartato" and the M14 use-by badge; "Diviso da <lotto>" as a link to the parent, and "Parti divise" as links to the children), then three `secondary` buttons "Conta", "Scarta" and "Dividi", each shown only when the server says the batch `can` do it. A tap opens one bordered inline form (not a `Card`) with one primary button: "Registra conteggio" (decimal "Porzioni contate", hint "Attese: 6"), "Registra scarto" (decimal "Porzioni da scartare" with a `quiet` "Tutte (6)", and the seven reasons of the stock catalogue) or "Dividi lotto" (whole "Porzioni da spostare", "Ubicazione" only with two or more locations, "Conservazione da adesso (ore)" prefilled with the server's hours left). After a split the child's label opens with a `SuccessNote`. "Storico" is a `LedgerList` of `.num` lines ("Scarto · Deteriorato · −3 porzioni · CD · 24/10/2026 12:10"); "Ristampa etichetta" opens the label, which now prints the portions left and, for a part of a split, a seventh line "Diviso da: <lotto>". On `/produzione` each row gains an "Apri" link and a state `Badge`, and a text link "Pasti del personale" sits under the primary "Nuova produzione". `/produzione/personale` shows the business day the server names, then a `LedgerList` of rules: "Ragù (demo) · 2 porzioni", "Disponibili: 6" and the row's one primary 44 px button "Conferma pasto di oggi" (a `quiet` "Cambia quantità" opens "Quantità di oggi"); once confirmed the row reads "Confermato alle 12:10 · CD" and has no button. The bordered "Regole" section holds a `secondary` "Aggiungi regola" that opens the "Nuova regola" form (its submit "Salva regola" is `secondary`, so the confirm buttons stay the page's only primary actions; a refused field gets `aria-invalid` and the message). `/magazzino/sprechi` now shows, under each reason's total, "Magazzino 0,50 €" and "Preparazioni 6,00 €", and the batch lines "Ragù (demo) · 3 porzioni · 6,00 €", or "non valorizzato" when the batch cost is incomplete, never "0,00 €". **The chef's markup on all of these has no euro sign.** In the stock history a waste from a staff meal reads "Pasto personale" and has no "Annulla". Nothing here adds portions, compares a date or works out a state.

**M18, order entry (built):** `/tavoli/[sessionId]` ("Comanda") is the waiter's one-thumb screen at 360 px. From the top: a "← Tavoli" link, the table name as the `Heading`, a `.num` "4 coperti" and the table's status `Badge`; a sticky `tablist` of the five courses ("Antipasti", "Primi · 2", ...), each a 44 px button that wraps onto a second row instead of scrolling, so every course is in reach; the "★ Da proporre" strip of pushed dishes (the star and the words, never colour alone, with the push price in `.num`); then the selected course's dishes grouped by category, and a collapsed "Altri piatti" with the rest. Every dish is one full-width button named "Aggiungi <piatto>" with the price at the right edge (the push price while pushed); "Ne restano 3" (a bold `warning` line, from the database's `lowStock`) or, when the dish cannot be ordered, a greyed `sunk` button with the word "Esaurito" and `aria-disabled`. The order is a sticky bar "Comanda · 7 righe" (`aria-expanded`) that opens one `Card` with the lines grouped by course: "2 × Spezzatino con polenta (demo)", `Badge`es "Da dividere" and "Segue", the note in muted text, "Invio…" while a line is on its way and "Non inviata" with "Riprova" / "Scarta" when the connection failed (the retry sends the same line id, never a second line). A tap on a draft line opens its editor in place (a `sunk` bordered block, not a `Card`): "−" / "+" with the quantity in `.num` (whole portions; "½" for a half), the "Mezza porzione", "Segue" and "Piatto condiviso" toggles (`aria-pressed`, the primary fill when on), a "Portata" `Select` for the move, the "Nota" field (140 characters, hint "Solo indicazioni per la cucina, niente nomi dei clienti", sent when it loses focus), "Rimuovi" (`danger`) and "Fatto". A lost race shows one `warning` alert "Questa riga è stata cambiata da <nome> alle 20:31: ecco la versione attuale." with the line as it is now, and the line on screen takes the server's values. A dish that ran out shows "<piatto> è esaurito." in an `ErrorAlert`. The chef sees one `ErrorAlert` and no euro sign. The screen reads the menu and the order every 15 seconds while visible; a successful write does not trigger a read (the reply is the line). Nothing on it adds, multiplies or compares: quantities, prices, the "few left" call and the timestamps are the API's. "Prendi la comanda" (`primaryLinkClass`) on the table panel of `/tavoli` opens it, and "Tavoli" stays the current tab.

**M19, sending, voids and the kitchen (built):** on the Comanda each course of the open sheet ends with up to two 44 px buttons: "Invia primi · 2" (primary) for the confirmed drafts and "Invia a seguire · 1" (secondary) for the segue ones, named for assistive tech "Invia in cucina: Primi, 2 piatti"; while a line of the course is still on its way or failed both are off and the muted line "Attendi l'invio delle righe" says why, and the pressed button says "Invio…" until the reply. A sent line shows the `success` badge "In cucina" and a `danger` "Storna" button that opens, in place, a `sunk` block with the "Motivo" `Select` (six reasons, none chosen), the muted hint "Il piatto resta scaricato dal magazzino e conta come scarto." and "Storna piatto" / "Annulla"; a voided line is struck through with the `warning` badge "Stornato". `/cucina` is the kitchen list: the `Heading` "Cucina", "Aggiornato alle 20:31", the "Alto contrasto" toggle (`aria-pressed`), a `warning` alert "Dati non aggiornati da più di un minuto. Controlla la connessione." when the last good read is older than a minute, and one `article` per ticket in a grid `repeat(auto-fill, minmax(18rem, 1fr))` (one column at 360 px, several on a laptop): the table name in the display face, "4 coperti", the course with an "A seguire" badge, "20:31 · Cameriere Demo", then the lines as "2 × Spezzatino con polenta (demo)" with "Da dividere" and the note; a voided line is struck through and says "Stornato · Errore in cucina" in words. It polls every 5 s while visible; no euro sign exists on it. **High-contrast mode** (`data-contrast="high"` on the screen, kept in `localStorage`, on by default with `prefers-contrast: more`): the muted ink becomes the full ink, tickets get 2 px `ink` borders and names and quantities grow; only `ink` on `paper`, `surface` or `sunk` (and `paper` on `ink` for the pressed toggle) is used, all at least 7:1 in both themes (`HIGH_CONTRAST_PAIRS` in `src/lib/design/tokens.ts`, tested in `tests/design/kitchen-contrast.test.ts`).

**M6+, kitchen screens:** go larger (18 px body, 56 px rows). Portion counts and expiry dates are
the headline of each row. Expiry maps to `warning` or `danger` badges with text. Waiters never
see costs, and role-based screens must not render cost columns at all. Test dark first, since a
dim kitchen is likely to use it. Live updates change rows in place, and only new rows rise.

## 9. Open items and TODO

- **TODO, logo:** when the real logo file arrives (SVG preferred, otherwise a 2× PNG):
  - put it in `public/brand/`;
  - replace the inner markup of `BrandMark` in `src/components/brand.tsx` with an `<img>` or
    inline SVG at 24 px high, keeping `aria-hidden` (the wordmark text names the app);
  - check it on the green band in both themes.
- **TODO, PWA icon:** derive `icon-192.png`, `icon-512.png` and a maskable variant from the logo
  on the brand green, plus `apple-touch-icon.png`. Add them to the web manifest when the PWA
  milestone adds it.
- **Client facts:** done 2026-10-22. The trading name "Osteria Dei Rossi", the eight brand colours
  and the two fonts are founder-approved and copied into `docs/client-facts.md`. The logo, other
  colours, Source Serif 4, the site's badge wording, contacts and the menu remain
  unapproved.

## 10. Verification and screenshots

- `npm test` runs `tests/lib/design/*` (contrast maths, every pair in both themes, CSS against
  `tokens.ts`, brand mapping, accent-only rule, `backwards` fill, reduced motion, font guard),
  `tests/lib/nav/is-current.test.ts` and `tests/components/file-picker.test.ts`.
- `npx playwright test e2e/smoke.spec.ts e2e/fonts.spec.ts` runs without the Supabase stack.
- `expectPhoneFriendly` (`e2e/helpers/session.ts`: controls ≥ 44 px, no sideways scroll) runs in
  the signed-in specs, which need the local Supabase stack. It covers:
  - `/anagrafiche/ubicazioni`, `/anagrafiche/ingredienti` and `/anagrafiche/fornitori`;
  - a supplier detail page `/anagrafiche/fornitori/[id]` (in `master-data.spec.ts`);
  - `/fatture` and an invoice detail page `/fatture/[id]` (in `invoice-upload.spec.ts`);
  - the review page `/fatture/[id]/revisione` with every editor closed, with a line editor open and
    with the split form open, in light and dark; and `/fatture/qualita` (in `invoice-review.spec.ts`,
    which also checks the laptop layout at 1280 × 800); and the same page with the approval
    panel, its second-tap confirmation and the reject form open, in light and dark, and approved,
    rejected and blocked (in `invoice-approval.spec.ts`, which also checks the laptop layout).

  It does **not** cover:
  - `/login`, which `smoke.spec.ts` checks with its own equivalent;
  - Home `/`, `/anagrafiche/importa` and `/anagrafiche`.

  The screenshot harness below runs the same checks on Home and `/anagrafiche/importa` as well.
- Screenshots at 360 × 740 (2× pixel density), light and dark, are in
  `docs/design/screenshots/`. They come from the production build (`npm run build && npm run
  start`):
  - `login-*.png` is the real page;
  - `home-*`, `fatture-*`, `fattura-*` and `fornitore-*` were taken with a throwaway harness
    kept outside the repository: a fake auth endpoint on `127.0.0.1:54321`, and Playwright
    `page.route` fixtures for `/api/*` with fake data ("Osteria Demo", "Fornitore Demo Srl");
  - `revisione-*`, `revisione-modifica-*` and `qualita-*` are phone shots of the review page (the
    whole page, and with a line editor open) and the quality page; `revisione-laptop-*` is the
    1280 × 800 viewport. Same throwaway harness; the fixture is deliberately busy (every badge,
    a split line, a long unbroken description). The harness has no PDF viewer, so the laptop
    document frame is blank in the shots;
  - `display-font-bodoni.png` is the display-weight comparison from §3.

  The app has no preview route, and nothing is reachable without a session.

**M13, counts and activity log (built):** `/magazzino/conteggi` has one `Card` "Conteggio in corso" ("Giornaliero · Cella (demo) · 12 di 20 contati" and a primary link "Riprendi") or, with no count open, the primary "Conteggio giornaliero", a `secondary` "Conteggio mensile" and a "Ubicazione" `Select` only with two or more locations; a text link "Ingredienti critici (20)"; then a `LedgerList` of past counts (type word and location, a `Badge` "In corso" info, "Chiuso" or "Annullato" neutral, a `.num` line "23/10/2026, 10:12 · Chef Demo" with "tu" and "un collega" for the chef, "3 differenze" and a link "Scostamenti" once closed) and "Mostra altri". `/magazzino/conteggi/critici` is one 44 px labelled `Checkbox` per active stock ingredient, "Selezionati: 18" from the server and a `SuccessNote` `role="status"` "Salvato." after each change. The quick count `/magazzino/conteggi/[id]` is built for the kitchen: rows 56 px high with the name in bold, "Atteso 12,3 kg" in `.num` (the snapshot once entered, else the quantity now) and exactly ONE decimal text input per ingredient ("Contato (kg)", `inputmode="decimal"`, `enterkeyhint="next"`, the unit as a suffix); leaving an input saves that line and shows "Salvato" with the server's difference ("Differenza −0,5 kg" or "Nessuna differenza"), Enter moves to the next input. A `warning` note says how many invoices still wait for approval. The sticky bar at the bottom shows "15 di 20 contati" and the one primary "Chiudi conteggio"; the second tap says what will be recorded and that it cannot be undone and shows "Conferma chiusura"; "Annulla conteggio" is `quiet` with its own confirmation. After the close one `SuccessNote` `role="status"` ("Conteggio chiuso: 3 differenze registrate.") and a link to the variance. `/magazzino/conteggi/[id]/scostamenti` filters "Solo differenze" / "Tutti" (`aria-pressed`) over a `LedgerList` ("Atteso … · Contato … · Differenza …"); owner and admin also get the value of each line ("−5,00 €", or "valore non disponibile", never "0,00 €") and one `Card` `dl` with "Perdite", "Eccedenze", "Netto" and "Righe senza prezzo"; the chef's page has no euro sign. `/magazzino/riconciliazione` has "Dal", "Al" and (with two or more locations) "Ubicazione", and a `LedgerList` per ingredient with three `.num` lines (opening, receipts, consumption, waste; transfers, adjustments, closing; the latest count) and a `Badge` with a word: `success` "Quadra", `warning` "Movimenti dopo il conteggio: −0,5 kg", neutral "Non contato", `danger` "Non quadra". `/registro` ("Registro attività", owner and admin; a chef or waiter sees one `ErrorAlert`) has "Dal", "Al", the text filters "Tutto", "Magazzino", "Documenti" and a `LedgerList` of entries: a neutral `Badge` with the action word, the subject ("Manzo muscolo (demo) −1,5 kg · Cella (demo) · Deteriorato", "Fattura 123/A") and a `.num` line with the Europe/Rome time and the person. `/magazzino` gains the text links "Conteggi" and "Riconciliazione" (owner, admin, chef) and "Registro attività" (owner, admin); the home card gains "Registro attività" for owner and admin. No new `OwnerNav` tab. Nothing on these screens adds a quantity or compares a date; **no count screen except the owner's and admin's variance shows a euro sign**.

**M16, reorder, prep and purchase rules (built):** `/riordino` ("Riordino e preparazione", owner, admin and chef) is three link cards with a server count each: "Ingredienti (3 da completare)", "Fornitori (2)", "Ricette (1)". A waiter sees one `ErrorAlert`: "Il riordino non è disponibile per il tuo ruolo." `/riordino/ingredienti` is one bordered `Card` per stock ingredient: the name in bold, a `.num` line "In giacenza 9 kg", a `warning` `Badge` "Da completare" with the reason in words ("Fornitore senza giorni di consegna") or a neutral `Badge` "Non attivo" when there is no minimum, and a muted `.num` line from the server's window ("Prossimo ordine entro mar 03/11, 11:00 · consegna gio 05/11"). Owner and admin get "Minimo" and "Obiettivo" (`inputmode="decimal"`, the unit as an `aria-hidden` suffix outside the label), a "Fornitore preferito" `Select` ("Macelleria X (demo) · confezione 5 kg") and one `secondary` "Salva"; the chef gets the same values as a `dl` and nothing to type. Both keep the "Conteggio giornaliero" `Checkbox` (M13's flag). `/riordino/fornitori` has "Giorni di anticipo" (`inputmode="numeric"`), a `fieldset` "Giorni di consegna" with seven 44 px `Checkbox`es "Lun" to "Dom" in one wrapping row, "Ordine entro le" (`type="time"`) and "Salva"; `/riordino/ricette` has "Porzioni minime", "Porzioni obiettivo" and "Tempo di preparazione (min)" (`inputmode="numeric"`), each with a muted "dalla ricetta v3" described-by hint only when the value comes from the recipe version, and "Restano 4 porzioni". A card sends only the fields that changed (a version value never becomes a rule by accident) and shows the server's Italian error in an `ErrorAlert` above its button; one `SuccessNote` `role="status"` "Salvato." follows a save. "Riordino" is a tab of `OwnerNav` and a link on the home card for owner, admin and chef. **No rules screen shows a euro sign**, and nothing on them computes a window, a status or a quantity.

**M17, menu and tables (built):** `/tavoli` ("Tavoli", owner, admin and waiter) is a two-column grid at 360 px (three from 640 px) of whole-tile buttons of at least 44 px, each with `data-table-id`: the name in bold, a `Badge` with the status word ("Libero", "Aperto", "Portate inviate", "Conto richiesto", "Chiuso"; the tone only reinforces it) and, for a table with a session, two `.num` lines "4 coperti" and "Cameriere Demo · 20:15" (the opener; the date is added, "25/10 01:30", when the table was opened in an earlier business day). A free or closed tile opens a bordered `Card` above the grid: "Apri Tavolo 1 (demo)", "Coperti" (`inputmode="numeric"`) between a 44 px "−" and "+" and the primary "Apri tavolo"; the session id is made once when the card appears and kept for a retry. An open tile opens the panel: "4 coperti", the opener line, "Coperto 6,00 €" only when the table has a coperto, a `secondary` "Modifica coperti" and the "Conto richiesto" toggle button (`aria-pressed`, primary while on). A refused opening shows the server's words as an `ErrorAlert` ("Il tavolo è già aperto da Cameriere Demo.") and the grid is read again; it is also read every 15 seconds while the page is visible and after each write. Owner and admin get an "Impostazioni" link; the chef gets one `ErrorAlert` and no euro sign. `/tavoli/impostazioni` ("Tavoli · impostazioni", owner and admin): a "Nuovo tavolo" card ("Nome", "Ordine", "Aggiungi tavolo"), one `Card` per table (name, `.num` order, an "Aperto" `Badge`, `secondary` "Rinomina" that opens "Nome" and "Ordine", and an "Attivo" `Checkbox` sent at once; the row shows the server's "Chiudi prima il tavolo aperto.") and the "Coperto" card ("Coperto a persona (€)" with `inputmode="decimal"`, empty means no coperto; "Aliquota IVA del coperto" `Select` pre-filled from the coperto or the server's default; "Si applica ai tavoli aperti da ora in poi."). `/menu` ("Menu", owner and admin) groups the items by category in the API's order: a `Card` per item with the name in bold, a `.num` line "14,00 € · IVA 10 %", the course word, "Ricetta: …" when mapped, `Badge`es "Senza ricetta" (warning), "Ricetta disattivata" (warning), "Non disponibile" and "Non attivo", and `secondary` "Modifica". "Nuovo piatto" and "Modifica" open one `Card` form: "Nome", "Categoria" (with a `datalist` of the existing ones), "Portata", "Ricetta" ("Nessuna ricetta" first), "Prezzo (IVA inclusa)" (`inputmode="decimal"`), "Aliquota IVA" (pre-filled from the server's default), "Ordine", "Disponibile" and, when editing, "Attivo"; a refused field gets `aria-invalid` and its message, a refused save the server's words in an `ErrorAlert`, and an edit sends only the fields that changed. "Tavoli" is a tab of `OwnerNav` for owner, admin and waiter, "Menu" for owner and admin, and both are links on the home card. **The waiter's pages show sale prices and the coperto only: no "Costo", "Margine" or "Food cost".** Nothing here works out a status, a total, a price or a date.
