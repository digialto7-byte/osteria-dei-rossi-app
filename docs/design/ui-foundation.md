# UI foundation: "il registro della trattoria"

Status: adopted on `feat/ui-foundation` (2026-10-22). This is the house style for every screen of
the app. It is neutral and unbranded: no client facts or logos are approved
(`docs/client-facts.md`), and the app shows no DigiAlto name or logo either. **The colour and font
tokens are the only branding hook.** When client branding is approved, change the tokens in
`src/app/globals.css` and `src/lib/design/tokens.ts`; components and screens do not change.

## 1. Direction

The app is a working kitchen ledger, used on a phone by an owner or chef, often mid-service, with
wet hands and little attention to spare. It should feel like a well-kept *registro*: warm paper,
dark ink, hairline rules between entries, one terracotta pencil for what matters. It should not
look like a generic SaaS dashboard.

Four principles, in priority order:

1. **Legible at arm's length.** Body text is 16 px Atkinson Hyperlegible, which was designed for
   low vision. Every text pair is AA in both themes, controls are 44 px or more, and figures line up.
2. **Calm.** One accent colour, used only for the primary action, links and focus. Everything
   else is ink on paper. Colour that carries meaning (status) always comes with a word.
3. **Ruled, not boxed.** Lists are ledger rows separated by hairlines. Cards are kept for forms
   and fact sheets, so one screen has one or two of them, never a grid of tiles.
4. **Crafted, not decorated.** Atmosphere comes from cheap CSS only: a paper tooth, double rules,
   the red margin line on the login page, and one reveal motion. There are no images and no
   gradients on controls.

## 2. Colour tokens

The runtime source is the Tailwind v4 `@theme` block in `src/app/globals.css`, plus the
`@media (prefers-color-scheme: dark)` override on `:root`. `src/lib/design/tokens.ts` mirrors the
values for the tests. `tests/lib/design/tokens.test.ts` fails if the two files differ, or if any
pair below drops under its AA minimum, in either theme.

Utility names follow the token: `bg-paper`, `text-ink-muted`, `border-rule`, `bg-accent
text-on-accent`, and so on.

| Token | Light | Dark | Role |
|---|---|---|---|
| `paper` | `#F6F1E7` | `#17140F` | Page background |
| `surface` | `#FBF8F2` | `#211C16` | Cards, inputs, secondary buttons |
| `sunk` | `#ECE4D5` | `#2B251E` | Hover fill, neutral badge, chosen-file chip |
| `ink` | `#1D1A16` | `#F2EADB` | Body text, current nav tab fill |
| `ink-muted` | `#5C5348` | `#BDB2A0` | Hints, secondary row text, `dt` labels |
| `rule` | `#E2D8C7` | `#3A3229` | Hairlines between rows, card borders (decorative) |
| `rule-strong` | `#8C806E` | `#857865` | Input borders (a UI boundary, ≥ 3:1) |
| `accent` | `#B4472B` | `#DB6C4D` | Primary button fill (terracotta) |
| `accent-hover` | `#963820` | `#E8836A` | Primary button hover |
| `on-accent` | `#FFFFFF` | `#1A0E09` | Label on the primary button |
| `accent-ink` | `#A8401F` | `#EF9274` | Accent used as text: links, quiet buttons |
| `olive` | `#56663A` | `#B2C287` | Secondary button text and border |
| `focus` | `#B4472B` | `#EF9274` | Focus ring |
| `success` / `success-bg` | `#2D6435` / `#E2ECD9` | `#A3D4A9` / `#1B2C1D` | Confirmations, "Approvata" |
| `warning` / `warning-bg` | `#74480A` / `#F5E5C3` | `#EBC57E` / `#302511` | "Da controllare", "Duplicata" |
| `danger` / `danger-bg` | `#9A2A1D` / `#F6DDD5` | `#F4A694` / `#391A12` | Errors, "Rifiutata", "Lettura non riuscita" |
| `info` / `info-bg` | `#1E5470` / `#DCE8EE` | `#A1CBE2` / `#14252F` | "In lettura" |

In dark mode the paper is a warm near-black and the ink is cream. The accent family gets lighter,
and the primary button switches to a dark label (`on-accent`), because white on a lighter
terracotta would fail AA.

### Contrast ratios (WCAG 2.2, tested)

The minimum is 4.5:1 for text and 3:1 for UI boundaries and focus indicators (SC 1.4.11).

| Foreground | Background | Used for | Min | Light | Dark |
|---|---|---|---|---|---|
| `ink` | `paper` | Body text on the page | 4.5 | 15.40 | 15.36 |
| `ink` | `surface` | Text in cards and inputs | 4.5 | 16.35 | 14.14 |
| `ink` | `sunk` | Text on hovered rows and tabs | 4.5 | 13.72 | 12.67 |
| `paper` | `ink` | Current tab in the owner nav | 4.5 | 15.40 | 15.36 |
| `ink-muted` | `paper` | Hints and secondary row text | 4.5 | 6.70 | 8.78 |
| `ink-muted` | `surface` | Hints inside cards | 4.5 | 7.11 | 8.08 |
| `ink-muted` | `sunk` | Neutral status badge | 4.5 | 5.97 | 7.24 |
| `on-accent` | `accent` | Primary button label | 4.5 | 5.42 | 5.64 |
| `on-accent` | `accent-hover` | Primary button label, hover | 4.5 | 7.28 | 7.10 |
| `accent-ink` | `paper` | Links and quiet buttons | 4.5 | 5.46 | 7.90 |
| `accent-ink` | `surface` | Links inside cards | 4.5 | 5.80 | 7.27 |
| `accent-ink` | `sunk` | Quiet button, hover | 4.5 | 4.86 | 6.52 |
| `olive` | `paper` | Secondary button label | 4.5 | 5.56 | 9.59 |
| `olive` | `surface` | Secondary button label in cards | 4.5 | 5.90 | 8.82 |
| `olive` | `sunk` | Secondary button label, hover | 4.5 | 4.95 | 7.91 |
| `success` | `success-bg` | Success notice and badge | 4.5 | 5.77 | 8.81 |
| `warning` | `warning-bg` | Warning badge | 4.5 | 6.31 | 9.17 |
| `danger` | `danger-bg` | Error alert and badge | 4.5 | 5.96 | 8.06 |
| `danger` | `paper` | Per-row import errors on the page | 4.5 | 6.85 | 9.38 |
| `info` | `info-bg` | Info badge | 4.5 | 6.58 | 9.10 |
| `rule-strong` | `surface` | Input border in cards | 3 | 3.65 | 3.92 |
| `rule-strong` | `paper` | Input border on the page | 3 | 3.44 | 4.26 |
| `accent` | `paper` | Primary button shape on the page | 3 | 4.81 | 5.48 |
| `olive` | `paper` | Secondary button border | 3 | 5.56 | 9.59 |
| `focus` | `paper` | Focus ring on the page | 3 | 4.81 | 7.90 |
| `focus` | `surface` | Focus ring in cards | 3 | 5.11 | 7.27 |

The paper tooth (two dot grids at 2.5–4 % ink) and the top wash (5 % accent, fading out within
14 rem) shift the page background by less than 2 % luminance. Every pair keeps a margin over its
minimum, and the tightest is `accent-ink` on `sunk` at 4.86. A new combination is added to
`CONTRAST_PAIRS` in `tokens.ts` before it is used, so it is tested in both themes.

## 3. Typography

Both faces are loaded with `next/font/google` in `src/app/layout.tsx`. They are **downloaded at
build time and served from `/_next/static/media`**: the browser never contacts Google, which
matters under GDPR for an EU venue. No npm dependency is added. Three checks guard this:

- `tests/lib/design/fonts.test.ts` checks that no source file names a Google Fonts host and that
  the layout uses `next/font`;
- `e2e/fonts.spec.ts` scans `.next/static` and `.next/server/app` for those hosts after
  `npm run build`;
- the same spec records every network request on `/login`. It asserts that none goes to Google,
  that the `.woff2` files come from `/_next/static/media` on the app's own origin, and that both
  faces are actually applied.

When the nonce-based CSP lands (M25), keep `font-src 'self'` and `style-src 'self'` plus the
nonce. Nothing in this foundation needs a third-party origin, `data:` URIs or inline `style`
attributes. The stagger uses `:nth-child`, and the select chevron and paper tooth are pure CSS.

| Role | Face | Size / leading | Notes |
|---|---|---|---|
| Page title (`Heading`, h1) | Instrument Serif 400 | 36 px / 1.05, −0.015 em | `text-balance`. Login title is 44 px |
| Section title (`SubHeading`, h2) | Instrument Serif 400 | 26 px / 1.2 | Also the tenant name on Home |
| App name in the header | Instrument Serif 400 | 22 px / 1 | Above a double rule. Not a heading |
| Body and controls | Atkinson Hyperlegible 400 | 16 px / 1.5 | Inputs stay 16 px so iOS does not zoom |
| Labels, row titles, buttons | Atkinson Hyperlegible 700 | 15–16 px | |
| Hints, meta lines | Atkinson Hyperlegible 400 | 14 px / 1.375 | `text-ink-muted` |
| Loading and empty lines | Atkinson Hyperlegible italic | 16 px | `Muted` |
| Amounts, quantities, dates, VAT numbers | Body face + `.num` | Same as context | `font-variant-numeric: tabular-nums` |

Fallbacks are Next's metric-adjusted "… Fallback" faces, then Georgia or `ui-sans-serif`. Inter,
Roboto and system UI faces are never the visible face. Serif is for display only: never set
labels, buttons, amounts or anything a chef reads in a hurry in it.

## 4. Space, shape, atmosphere

- **Column:** `max-w-md`, a 16 px side gutter and a 24 px vertical rhythm between page blocks
  (`gap-6`). Inside a card, fields sit 16 px apart and a label sits 6 px above its control.
- **Radius:** 8 px for controls (`rounded-lg`), 14 px for cards (`rounded-card`), full for pills
  and badges.
- **Rules:** a 1 px `rule` hairline between ledger rows, and a 3 px double rule (`border-double`)
  under the app name and the login title, like the head of a ledger page.
- **Depth:** cards get a 1 px border plus a soft long shadow. The primary button gets a 1 px
  bottom shade. There are no other shadows.
- **Paper:** the `body` background has two offset dot grids and a faint top wash, all in CSS. It
  adds no bytes over the network and has no CSP impact.

## 5. Motion

- **One reveal:** direct children of `<main>` (`.reveal`) and ledger rows (`.ledger`) rise 6 px
  and fade in over 420 ms with `cubic-bezier(0.22, 1, 0.36, 1)`, staggered 40 ms and capped at
  280 ms. A row added later (after "Aggiungi") rises on its own. Alerts and notices use the same
  rise when they appear.
- **States:** hover fills `sunk` on rows, tabs and secondary buttons and darkens the primary
  button. Press nudges buttons down 1 px (`active:translate-y-px`). Transitions last 150 ms.
- **Focus:** a 3 px `focus` outline with a 2 px offset on every focusable element
  (`:focus-visible`). Never remove it. If a component needs a different ring, change the colour,
  not the presence.
- **Reduced motion:** the `prefers-reduced-motion: reduce` block in `globals.css` cuts every
  animation and transition to 0.01 ms *and zeroes animation delays*, so nothing waits invisible.
  A test guards that block.

## 6. Components (`src/components/ui.tsx`)

All existing props and accessible names are unchanged. Each control is labelled and at least 44 px
tall (`min-h-tap`); `expectPhoneFriendly` in the e2e helpers enforces this on every screen.

| Component | Rule |
|---|---|
| `Field` | A wrapping `<label>`: bold label, the control, then an optional muted hint. Always use it, so `getByLabel` keeps working |
| `TextInput` / `Select` | `surface` fill, `rule-strong` border, 8 px radius, inset hairline shadow. `Select` draws its chevron in CSS (no image) |
| `Checkbox` | 20 px native box tinted with `accent-color`. The whole label row is the 44 px target |
| `Button` `primary` | One per form or screen: the action that moves the work forward ("Aggiungi", "Carica", "Inviami il link") |
| `Button` `secondary` | Olive outline on `surface`. Row actions ("Disattiva", "Rendi preferito") and "Esci" |
| `Button` `quiet` | Accent text, no border. Low-stakes actions next to a primary ("Annulla") |
| `linkClass` | Navigation set as text: bold `accent-ink`, underlined, 44 px tall |
| `fileInputClass` | Native file input. The picker button looks like a secondary button |
| `ErrorAlert` | `role="alert"`, a `danger` left bar on `danger-bg`. One per failure, next to what failed |
| `SuccessNote` | A `success` left bar on `success-bg`. The caller passes `role="status"` when it must be announced. Use only one `status` per screen, because e2e tests select it by role |
| `Heading` / `SubHeading` | Serif h1 and h2. One h1 per screen |
| `Card` | A raised sheet for a form or a fact sheet (`dl`). At most two per screen |
| `LedgerList` / `LedgerRow` | `ul`/`li` with hairlines and the staggered rise. A row that opens something is a full-width link with a muted `›` |
| `Muted` | Italic muted line for "Caricamento…" and empty states |
| `StatusBadge` (`fatture/status-badge.tsx`) | Pill with a dot and the Italian label. The tone maps from the status (`neutral`, `info`, `warning`, `success`, `danger`). Colour never stands alone |
| `OwnerNav` (`(owner)/owner-nav.tsx`) | Index-tab pills that wrap onto two lines at 360 px rather than hiding tabs. The current tab is ink-filled with `aria-current="page"`. Links only, no list items |

## 7. Do and don't

**Do**

- take every colour from a token utility (`bg-surface`, `text-danger`); add a token and a
  contrast pair before you need a new colour;
- put `.num` on every amount, quantity, date and code a person compares down a column;
- keep amounts in the `1.234,50 €` format (`src/lib/money/format.ts`) and dates in Europe/Rome
  (`src/lib/time/format.ts`); the style never reformats data;
- reach for a ledger row first, a card second, and a new component last;
- check new screens at 360 × 740 in both themes and with reduced motion.

**Don't**

- use Tailwind palette colours (`stone-*`, `red-*`, …) or hex values in components;
- use terracotta for anything but the primary action, links and focus. It is a pencil mark, not
  a background;
- set body text, labels or numbers in the serif;
- add images, icon fonts, `data:` URIs, inline `style` attributes or third-party origins;
- remove the focus outline, or use colour alone to carry a status;
- show the DigiAlto name or logo, or any client fact that is not in `docs/client-facts.md`.

## 8. Applying it to the next screens

**M4: invoice review** (extracted lines against supplier items):

- The header facts (supplier, number, date, total) go in a `Card` with a `dl`, as on the invoice
  detail page.
- Each extracted line is a `LedgerRow`: the description in bold, then a `.num` meta line with
  qty × unit price = amount, aligned right on a second line at 360 px.
- An unmatched line or a price jump gets a `warning` tone on a small badge plus a word ("Nuovo
  articolo", "+12 %"), never only a coloured cell.
- One primary action per screen ("Approva"). "Rifiuta" is `secondary`. A destructive confirmation
  uses `ErrorAlert` wording and keeps the same button order.
- Approval is a single transaction (`approve_invoice`). The UI shows one `SuccessNote` with
  `role="status"` afterwards, not one per line.

**M6+: kitchen screens** (production, portions, service):

- They are used standing at the pass, so go larger. Use 18 px body, and 56 px row targets via a
  `min-h-14` variant; never go below `min-h-tap`.
- Portion counts and expiry dates are the headline of each row: put them in `.num`, bold, at the
  row's right edge.
- Expiry urgency maps to `warning` (today/tomorrow) and `danger` (expired), always as a badge with
  text.
- Waiters never see costs. Role-based screens must not render cost columns at all; hiding them
  with CSS is not enough.
- Dark mode is the likely default in a dim kitchen or dining room. Test it first, and keep the
  terracotta for the single "Fatto" or "Invia" action.
- Keep the reveal for page load only. Live updates (Realtime) should change in place without
  re-animating the whole list. Rows keep stable `key`s, so only new rows rise.

## 9. Verification and screenshots

- `npm test` runs `tests/lib/design/*`: the contrast maths, every pair above in both themes,
  `globals.css` matching `tokens.ts`, the reduced-motion block, and the self-hosted-font guard.
- `npx playwright test` runs `e2e/fonts.spec.ts` (no Google hosts in the build or the network)
  and the existing specs with `expectPhoneFriendly`.
- Screenshots at 360 × 740 (2× pixel density) are in `docs/design/screenshots/`. They come from
  the production build (`npm run build && npm run start`).
  - `login-light.png` and `login-dark.png` are the real page.
  - The signed-in screens (`home-*`, `fatture-*`, `fattura-*`, `fornitore-*`) were taken against
    the same build with a throwaway local harness that was not committed: a fake auth endpoint
    on `127.0.0.1:54321`, and Playwright `page.route` fixtures for `/api/*` with fake data
    ("Osteria Demo", "Fornitore Demo Srl").
  - The app has no preview route, and nothing is reachable without a session.
