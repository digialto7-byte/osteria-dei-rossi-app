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
| `linkClass` | Navigation set as text: bold `accent-ink`, underlined, 44 px tall |
| `ErrorAlert` | `role="alert"`, a `danger` left bar on `danger-bg`. One per failure, next to what failed |
| `SuccessNote` | A `success` left bar on `success-bg`. The caller passes `role="status"` when it must be announced. One `status` per screen |
| `Heading` / `SubHeading` | Bodoni h1 (with the gold rule) and h2. One h1 per screen |
| `Card` | A raised sheet for a form or a fact sheet (`dl`). At most two per screen |
| `LedgerList` / `LedgerRow` | `ul`/`li` with hairlines and the staggered rise |
| `Muted` | Muted line for "Caricamento…" and empty states |

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

**M4, invoice review:** header facts go in a `Card` with a `dl`. Each extracted line is a
`LedgerRow` with a `.num` meta line. An unmatched line or a price jump gets a `warning` badge with
a word. "Approva" is the one green action and "Rifiuta" is `secondary`. Show one `SuccessNote`
with `role="status"` after approval.

**Menu and dish screens:** dish names in Bodoni at 21 px or more, prices `.num` at the right edge,
and `RecommendedBadge` on recommended dishes. Descriptions in Figtree; this is where Source Serif 4
may earn its place. Allergens are always words or numbered codes, never colour.

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
  - `/fatture` and an invoice detail page `/fatture/[id]` (in `invoice-upload.spec.ts`).

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
  - `display-font-bodoni.png` is the display-weight comparison from §3.

  The app has no preview route, and nothing is reachable without a session.
