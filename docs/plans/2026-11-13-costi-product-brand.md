# Tech plan delta — Costì product brand and rename (QW13)

- **Client slug / internal:** `osteria-dei-rossi` app, which becomes tenant #1 of the DigiAlto product **Costì**. The plan is internal and in English; the UI strings are Italian, with English second.
- **Repo and branch:** `osteria-dei-rossi-app`. Planned in worktree `/home/user/osteria-uxqw` (branch `feat/ux-quick-wins`). Built on **`feat/costi-product-brand`**, cut from `main` after the UX quick-wins staff PR merges (§5, "Split").
- **Author:** architect · **Date:** 2026-11-13
- **Delta to:**
  - `docs/plans/2026-11-13-ux-quick-wins.md` (QW list; its promise of "no new colours, fonts or sizes" is why this is a separate PR);
  - platform plan §5.5 and QW13 (`git show origin/main:docs/plans/2026-11-13-platform-saas.md`; read from the copy `/home/user/osteria-pd2/docs/plans/2026-11-13-platform-saas.md:663-720`).
- **Founder decisions 2026-11-13 (via the lead), recorded in DigiAlto-Ops by the lead:**
  - QW13 (the rename to "Costì") is approved for before go-live.
  - The Costì product brand is approved, with the product look on product surfaces only, also before go-live.
  - Palette, contrast rules and fonts come from DigiAlto-Ops `knowledge/agency/products/costi/brand.md`, relayed by the lead. That file is not in the local checkout (`/home/user/digialto-ops/knowledge/agency/products/costi/` does not exist here), so the values below are the relayed ones.
  - **Correction (founder):** the founder will send their own vector logo files. The SVGs in DigiAlto-Ops (`knowledge/agency/products/costi/assets/`, PR #58) are placeholders only, and they are not in the local checkout either. This plan builds with placeholders in named slots, and the later swap is a file-replace commit with no code change (§3.6).

Line numbers are from the worktree `/home/user/osteria-uxqw` unless a line says "origin/main". Several moved after §5.5 was written: `brand.tsx:59` (not `:39`), `it.ts:1518` (`nav.costs`, not `:1469`), `layout.tsx:67` (`metadata`, not `:68`).

---

## Summary for the lead

- **What changes.** The app gets the name "Costì" where the product speaks: the installed app, the browser tab, the sign-in pages and the sign-in e-mail. Those surfaces also get the Costì look: Forest, Coral, Sage, Off-white and Charcoal, Montserrat and Inter, the Costì icons and the favicon. Home, Sala, Cucina, the venue's header band, `/prenota` and guest e-mails keep the osteria look.
- **How.** The product look is a second set of values for the **same** token names, switched on by `data-brand="costi"` in two small layouts. The osteria tokens do not change. Phase-3 per-tenant themes can use the same mechanism.
- **The "Costi" nav label** becomes **"Costi dei piatti"**: the h1 of `/costi` and the Home action already say this.
- **Recommendation:** a separate PR, `feat/costi-product-brand`, straight after the staff PR, with QW13 inside it (§5, "Split"). The logo slots ship with placeholders. Go-live waits for the founder's files (checklist row BRAND-1, §5 step CB10).

---

## Lead decisions 2026-11-13 (plan 2896c07 approved, with the split)

- **Split:** approved. `feat/costi-product-brand` is cut after UX PR 2, with QW13 inside it.
- **Q-CB3:** the derived shades and the dark product theme are approved as computed. The CB4 tests stay authoritative.
- **Q-CB4:** Montserrat is for headings only.
- **Q-CB6: variant VD.** The guest booking tab title is the venue name, because guests book the osteria, not Costì. Costì appears only on
  staff and product surfaces. CB2 and CB7 apply VD, and their tests assert the venue name on `/prenota/*`.
- **Q-CB2:** the venue name stays in the band on `/login*`.
- **Q-CB8:** the PR may merge with placeholders. **BRAND-1 reads: "go-live blocked while placeholder logos remain, unless the founder
  explicitly approves the placeholders for go-live"** (their files may arrive late).
- **Q-CB10:** updating the hosted Auth template, subject and sender name is a founder step after merge (BRAND-2).
- **Labels:** "Costi dei piatti" and "Costi degli ingredienti", plus the clash guard, are approved.
- **Reserved Font Name:** CB7 checks the OFL header of each font file actually shipped, from the Montserrat and Inter release files,
  and records the result. The Montserrat 5.0.19 npm LICENSE the lead saw has no RFN line.
- **Logo:** the founder will send their own vector files. The DigiAlto-Ops SVGs are placeholders only. CB11 replaces the files and changes no code.

## 1. Goal and scope

**Goal.** Rename the product to Costì (QW13, platform plan §5.5) and give the product surfaces the Costì look, test-first. Keep every venue screen exactly as it is.

**In scope (product surfaces only):**
- **PWA manifest:** `name` and `short_name` "Costì"; icons 192 and 512, plus maskable; `theme_color` Forest `#0E4D3A`; `background_color` Off-white `#F7F8F6`.
- **The sign-in pages, all under `src/app/(public)/login/`:**
  - `/login`, with its password, e-mail-code and staff PIN views;
  - `/login/offerta-codice` (the offer);
  - `/login/codice` (the challenge);
  - `/login/attiva-codice` (forced enrolment).
- **`/dispositivo`.** `/pin` is a redirect to `/login` (`src/app/(public)/pin/page.tsx:4-6`), so it gets the look through `/login`.
  - On these pages the product frame is colours, fonts and the Costì logo in the page.
  - The header band keeps the **venue's** name, as §5.5 says ("header band wordmark … every page", platform plan `:673`; PIN and device pages `:677`).
- **Staff e-mail:** the local template `supabase/templates/magic-link.html` (the only file in `supabase/templates/`) and the subject in `supabase/config.toml:257`.
- **Favicon and apple-touch icon**, for every page. The tab title is "Costì" everywhere too (§5.5, `layout.tsx:67`).
- **The nav label "Costi"** (`it.ts:1518`) becomes unambiguous.
- **The product fact "Costì"** goes in `docs/client-facts.md`, under a new "Product (DigiAlto)" heading.

**Out of scope:**
- Venue screens: Home, Sala, Cucina, the header band's venue name and colours on signed-in pages, `/prenota/*` and guest e-mails (`src/server/reservations/mail/*`).
- Any change to the osteria token values.
- Hosted Supabase settings: the template, the subject and the SMTP sender name are the founder's dashboard step (§6).
- The console (SP3) and per-tenant names or themes (SP9).
- Internal names: `public/sw.js:2`, `osteria-sync` and backup names (H33, platform plan `:683`).

## 2. Current state (verified)

| Area | What exists (file:line) |
|---|---|
| Tokens (runtime) | Tailwind v4 `@theme` light block (`src/app/globals.css:12-56`); font stacks in `@theme inline` (`:62-66`), both built from the next/font variables `--font-body-ext`, `--font-body`, `--font-display-ext`, `--font-display-face`; dark override on `:root` under `@media screen and (prefers-color-scheme: dark)` (`:72-101`); `body` uses `--color-paper`, `--color-ink`, `--font-sans` (`:114-119`); focus ring `--color-focus` (`:121-124`); `.band` (`:143-159`) |
| Tokens (tests) | `COLOR_TOKENS` (`src/lib/design/tokens.ts:8-34`), `BRAND` (`:44-53`), `DERIVED` (`:73-77`), `THEMES` (`:79-134`), `CONTRAST_PAIRS` (`:148-180`), `ACCENT_ONLY` (`:183`). `tests/lib/design/tokens.test.ts` checks every pair in both themes (`:55-61`), that the CSS equals `THEMES` (`:201-207`), and that **no `--color-*` is declared outside the two blocks** (`:209-213`). `tests/config/ux-quick-wins-preserves.test.ts:20-23` pins the `@theme` colour **names** to `COLOR_TOKENS` |
| Fonts | Six committed woff2 files in `src/app/fonts/` (Fontsource 5.3.0 copies, checksums in `src/app/fonts/README.md:7-14`). `next/font/local` in `src/app/layout.tsx:16-65`; the variables go on `<html>` (`:86-89`). The guard is `tests/lib/design/fonts.test.ts`: file list `:8-15`, 4 × `swap` `:77`, 2 × `preload: false` `:91`, weights tied to file names `:105-120`. `e2e/fonts.spec.ts:37-79` loads `/login` and expects Bodoni Moda and Figtree (`:35`) |
| Title and theme colour | `metadata = { title: t("app.name") }` (`layout.tsx:67`); `viewport.themeColor` = osteria `band` in light and dark (`:68-76`) |
| Manifest | `src/app/manifest.ts:7-8` names "Osteria Dei Rossi"; colours `:13-14`; **no `icons`** (Q121, comment `:3-4`). Test `tests/app/manifest.test.ts:9-28`. `tests/config/m25b-preserves.test.ts:203-209` pins no shortcuts and `start_url "/"` |
| Icons, favicon | `public/` holds only `sw.js`. There is no `favicon.ico` and no `icon.*` or `apple-icon.*` under `src/app` (Glob) |
| Public layout | `src/app/(public)/layout.tsx:7-14`: `HeaderBand` with `PublicBrand` + `PageMain`, for `/login*`, `/pin`, `/dispositivo` and `/prenota/*`. `PublicBrand` shows the title for guests and the link elsewhere (`public-brand.tsx:8-10`). There is no nested `layout.tsx` under `login/` or `dispositivo/` (Glob) |
| Band and brand | `HeaderBand` (`src/components/header-band.tsx:8-17`, `border-gold`). `BrandMark` placeholder (`src/components/brand.tsx:12-24`). The wordmark text is `t("app.name")` (`brand.tsx:59`, `font-display`, uppercase) |
| Sign-in pages | `login-screen.tsx`: staff view `:36-55`; owner card `:58-83` with a `bg-gold` top rule (`:61`), h1 `font-display` (`:64`) and intro `login.intro` (`:67`). The offer, challenge and forced-enrolment pages are a `Card` + `Heading` (`offerta-codice/page.tsx:17-20`, `codice/page.tsx:14-17`, `attiva-codice/page.tsx:18-23`). `Heading` and `SubHeading` use `font-display … font-semibold` (`src/components/ui.tsx:191`, `:205`) |
| Staff e-mail | `magic-link.html:6` (title), `:10` (wordmark), inline styles `:8-13`, `:23`. Its colours are none of the osteria brand. `config.toml:256-258`. `tests/config/auth-templates.test.ts`: subject `:44-46`; "names the venue" `:91-98`; no `<img>`, no `url(` and no `http` (`:96`, `:100-105`) |
| Strings | `app.name` (`it.ts:2`, `en.ts:4`), `login.intro` (`it.ts:4`, `en.ts:6`), `brand.homeLink` (`it.ts:74`, `en.ts:75`), `nav.costs` "Costi" / "Costs" (`it.ts:1518`, `en.ts:1501`). Home heading `t("app.name")` (`src/app/(owner)/page.tsx:80`, `:88`) |
| `/costi` | The h1 is `costs.title` "Costi dei piatti" (`src/app/(owner)/costi/page.tsx:47`, `:55`; `it.ts:1416`; en "Plate costs" `en.ts:1399`). Links to ingredient costs, settings and the check (`:57-65`). The owner's fixed-cost card (`:69`). The list is plates. Home action `today.costs` "Costi dei piatti" (`it.ts:81`; en "Dish costs" `en.ts:82`). Nav entry `nav-model.ts:137`. The facet link from an ingredient uses `nav.costs` and goes to `/costi/ingredienti#…` (`src/lib/nav/facet-links.ts:56-61`) |
| CSP | ADR-028: `img-src 'self' <supabase>`, `font-src 'self'`, `worker-src`/`manifest-src 'self'` (`docs/adr/adr-028-nonce-csp-in-proxy.md:46-50`). The proxy skips `.svg\|.png…` (`src/proxy.ts:34`), so those files get the static policy (ADR-028 decision 3, `:61`; `next.config.ts:11-12`). `e2e/security-headers.spec.ts:139` pins the pre-rendered routes to `["/_global-error", "/manifest.webmanifest"]` |
| Service worker | Cache version = `?v=` = `NEXT_PUBLIC_APP_VERSION` = the commit SHA (`next.config.ts:31`; `src/pwa/register.ts:26`; `public/sw.js:19`). It caches only `/_next/static/`, three shell pages and four API reads (`sw.js:43-44`, `:309-331`). Old `static-`/`shell-` caches are deleted on activate (`:166-186`) |
| Dependencies | Pinned list `tests/config/no-new-deps.test.ts:6-34`. `sharp` is only Next's optional dependency (`node_modules/next/package.json:115`). `@playwright/test` and `tsx` are devDependencies (`package.json:38`, `:54`) |
| Facts | `docs/client-facts.md:12-15` (trading name, colours, fonts); "logo" not approved (`:30-31`). No product section |

## 3. Design

### 3.1 Placement (§5.5 kept, look added)

| Surface | Name shown | Look |
|---|---|---|
| Manifest, installed icon, splash | Costì | Costì (icons, Forest, Off-white) |
| Browser tab (`<title>`, favicon) on every page | Costì | Costì favicon |
| `/login*`, `/dispositivo` (and `/pin` → `/login`) | Costì logo and intro in the page; the band keeps the venue's name (FD34) | Costì tokens and fonts, page and band alike |
| Staff sign-in e-mail | Costì | Costì colours (inline) |
| Home, Sala, Cucina, signed-in shell, 404, `/prenota/*`, guest e-mails | Venue | Osteria (unchanged) |

### 3.2 The product theme: same token names, a second value set

**Decision.** `PRODUCT_THEMES` holds the **same 25 names** as `COLOR_TOKENS`, with Costì values.
- `globals.css` gets two new blocks, placed after the osteria dark block:

```css
/* Costì product theme (docs/plans/2026-11-13-costi-product-brand.md). Mirrored in tokens.ts (PRODUCT_THEMES.light). */
:root:has([data-brand="costi"]) {
  --color-paper: #f7f8f6;
  /* … every --color-* name, light values … */
  --font-display-face: var(--font-product-display);
  --font-display-ext: var(--font-product-display);
  --font-body: var(--font-product-body);
  --font-body-ext: var(--font-product-body);
}
@media screen and (prefers-color-scheme: dark) {
  :root:has([data-brand="costi"]) {
    color-scheme: dark;
    /* … every --color-* name, dark values (PRODUCT_THEMES.dark) … */
  }
}
```

- **Why `:root:has(…)`.**
  - The variables are set on `<html>`, so `body`'s background, the band (which sits above the page content in `(public)/layout.tsx`) and the browser's `color-scheme` all follow.
  - Specificity is (0,2,0). That beats the osteria `:root` (0,1,0) in both themes, and next/font's `.__variable_*` class (0,1,0) that sets the four font variables.
  - `:has` is already used in `globals.css:276`.
- **Why the font variables are remapped, not `--font-sans`.** The stacks in `@theme inline` (`:62-66`) are inlined into the utilities, but they end in the four next/font variables. Remapping those variables switches `font-display` and `font-sans` on every element, whether or not Tailwind emits `--font-sans` as a variable.
  - The latin-ext variables are mapped to the same product face. The Montserrat and Inter files are full-charset (§3.4).
  - Leaving a variable in the stack unset would make the whole `font-family` invalid.
- **Dark mode** follows the device, as the osteria theme does (`ui-foundation.md:36-43`). It is limited to `screen`, so print stays light.
  - The dark product values are **derived** (Q-CB3). The band stays Forest in both themes, which is why the manifest and `theme-color` are one value.
- **The switch.** Two new server layouts, which render no client code:
  - `src/app/(public)/login/layout.tsx` (covers `/login`, `/login/codice`, `/login/attiva-codice`, `/login/offerta-codice`);
  - `src/app/(public)/dispositivo/layout.tsx`.
  - Each renders `<ProductScope>{children}</ProductScope>`. `ProductScope` (`src/components/product-scope.tsx`) is `<div data-brand="costi" className="contents"><ProductLogo />{children}</div>`.
  - Each also exports `viewport = { themeColor: PRODUCT_THEMES.light.band }` (Forest). The Next.js 16 docs bundled with the app allow `viewport` in a `layout` or `page` (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-viewport.md:23`). The override on the nested segment is **checked by e2e**: exactly one `meta[name=theme-color]`, with `#0E4D3A`.
  - The server renders the attribute, so there is no flash and nothing to compute on the client.
  - `/prenota/*` and the signed-in shell have no such layout, so they keep the osteria values. Both are tested.
- **Phase 3 (per-tenant theming)** reuses the same contract:
  - a theme is a full value set for `COLOR_TOKENS`;
  - it is checked against `CONTRAST_PAIRS` in both themes;
  - it is applied by a scope attribute.
  - A tenant theme can be a second value of `data-brand`, or values read from the tenant record. That choice is for SP9. Nothing here assumes it.

**Mapping of the Costì roles onto the token names.**
- Coral takes `gold` and `highlight`, which are already `ACCENT_ONLY` (`tokens.ts:183`; never text, tested `tokens.test.ts:141-173`). That is exactly the brand rule "Coral is for accents, icons and large graphics only".
- `on-highlight` is Charcoal, which gives the coral button with Charcoal text (5.75).
- The status tones (`success`, `warning`, `danger`, `info` and their `-bg`) keep the osteria values. They are semantic, not brand, and their pairs are recomputed on the product backgrounds below.

### 3.3 Token table with contrast ratios

**How the ratios were computed.** By hand, with the WCAG formula of `src/lib/design/contrast.ts`. The relayed figures came out the same:
- Coral on Off-white 2.41;
- white on Coral 2.56;
- Charcoal on Coral 5.75;
- Forest on white 9.81.

The tests recompute every ratio (step CB4), and the tests are the authority. **Derived shades** use `mix(a, b, t)` (`tokens.ts:56-64`). The weights were chosen so that no channel lands exactly on .5, so rounding cannot differ.

**Brand (relayed):** Forest `#0E4D3A`, Coral `#FF7A5C`, Sage `#DCEDE6`, Off-white `#F7F8F6`, Charcoal `#1F2933`. White `#FFFFFF` is used as the card surface; the brand's own contrast rules quote it.

| Token | Light | Source | Dark | Source |
|---|---|---|---|---|
| `paper` | `#F7F8F6` | Off-white | `#1F2933` | Charcoal |
| `surface` | `#FFFFFF` | white | `#2C353F` | `mix(Charcoal, Off-white, 0.06)` |
| `sunk` | `#DCEDE6` | Sage | `#39424A` | `mix(Charcoal, Off-white, 0.12)` |
| `ink` | `#1F2933` | Charcoal | `#F7F8F6` | Off-white |
| `ink-muted` | `#555D64` | `mix(Charcoal, Off-white, 0.25)` | `#B2B6B8` | `mix(Off-white, Charcoal, 0.32)` |
| `rule` (decorative) | `#B3CDC4` | `mix(Sage, Forest, 0.2)` | `#4A525A` | `mix(Charcoal, Off-white, 0.2)` |
| `rule-strong` | `#757C81` | `mix(Charcoal, Off-white, 0.4)` | `#808689` | `mix(Charcoal, Off-white, 0.45)` |
| `band` | `#0E4D3A` | Forest | `#0E4D3A` | Forest |
| `band-ink` | `#F7F8F6` | Off-white | `#F7F8F6` | Off-white |
| `gold` (accent only) | `#FF7A5C` | Coral | `#FF7A5C` | Coral |
| `highlight` (accent only) | `#FF7A5C` | Coral | `#FF7A5C` | Coral |
| `on-highlight` | `#1F2933` | Charcoal | `#1F2933` | Charcoal |
| `accent` | `#0E4D3A` | Forest | `#DCEDE6` | Sage |
| `accent-hover` | `#153F37` | `mix(Forest, Charcoal, 0.4)` | `#ECF4F0` | `mix(Sage, Off-white, 0.6)` |
| `on-accent` | `#F7F8F6` | Off-white | `#1F2933` | Charcoal |
| `accent-ink` | `#0E4D3A` | Forest | `#DCEDE6` | Sage |
| `focus` | `#0E4D3A` | Forest | `#DCEDE6` | Sage |
| status tones and their `-bg` | unchanged | osteria `THEMES` | unchanged | osteria `THEMES` |

**Every `CONTRAST_PAIRS` entry against `PRODUCT_THEMES`** (min 4.5 for text, 3 for non-text):

| fg on bg (use) | Min | Light | Dark |
|---|---|---|---|
| `ink` / `paper` | 4.5 | 13.85 | 13.85 |
| `ink` / `surface` (text and border) | 4.5 / 3 | 14.76 | 11.68 |
| `ink` / `sunk` (text and tick) | 4.5 / 3 | 12.16 | 9.61 |
| `paper` / `ink` | 4.5 | 13.85 | 13.85 |
| `ink-muted` / `paper` | 4.5 | 6.29 | 7.22 |
| `ink-muted` / `surface` | 4.5 | 6.70 | 6.09 |
| `ink-muted` / `sunk` | 4.5 | 5.52 | 5.01 |
| `band-ink` / `band` (wordmark and band focus) | 4.5 / 3 | 9.21 | 9.21 |
| `on-accent` / `accent` | 4.5 | 9.21 | 12.16 |
| `on-accent` / `accent-hover` | 4.5 | 10.96 | 13.19 |
| `accent-ink` / `paper` | 4.5 | 9.21 | 12.16 |
| `accent-ink` / `surface` | 4.5 | 9.81 | 10.25 |
| `accent-ink` / `sunk` | 4.5 | 8.08 | 8.43 |
| `on-highlight` / `highlight` (Charcoal on Coral) | 4.5 | 5.75 | 5.75 |
| `success`, `warning`, `danger`, `info` on their `-bg` | 4.5 | 5.77, 6.31, 5.96, 6.58 (unchanged) | 8.81, 9.17, 8.06, 9.10 (unchanged) |
| `danger` / `paper` | 4.5 | 7.24 | 7.54 |
| `danger` / `surface` | 3 | 7.71 | 6.36 |
| `rule-strong` / `surface` | 3 | 4.24 | 3.38 |
| `rule-strong` / `paper` | 3 | 3.98 | 4.01 |
| `accent` / `paper` | 3 | 9.21 | 12.16 |
| `accent` / `surface` | 3 | 9.81 | 10.25 |
| `focus` / `paper` | 3 | 9.21 | 12.16 |
| `focus` / `surface` | 3 | 9.81 | 10.25 |
| `gold` / `band` (Coral rule under the band, Coral on Forest) | 3 | 3.82 | 3.82 |

**Pairs that fail, and so are never proposed:**
- Coral as text on Off-white: 2.41 (the `ACCENT_ONLY` test keeps it under 4.5).
- White or Off-white on Coral: 2.56 / 2.41.
- Forest on Coral: 3.82, which is non-text only.
- Coral on Sage: 2.11, which fails even 3:1, so Coral never sits on `sunk`.
- Forest on Charcoal: 1.50. That is why dark `accent` is Sage.

**E-mail pairs** (literal hex in the template; checked in `auth-templates.test.ts`, step CB8):

| Pair | Ratio |
|---|---|
| Charcoal `#1F2933` text on white card | 14.76 |
| Forest `#0E4D3A` wordmark text on white | 9.81 |
| White `#FFFFFF` on Forest button | 9.81 |
| `#555D64` footnote on white | 6.70 |
| Off-white page around the card, Coral 4 px top border | decorative, no minimum |

### 3.4 Fonts (self-hosted, no Google request)

| Face | Use in the product scope | Weights loaded | Source (official GitHub release) | Committed as |
|---|---|---|---|---|
| Montserrat | `font-display`: `Heading`, `SubHeading`, the login h1, the band wordmark (all `font-semibold`) | 600 | `JulietaUla/Montserrat` tag **v7.222** (the latest release; the release has only the source archives): `fonts/webfonts/Montserrat-SemiBold.woff2` and the root `OFL.txt` | `src/app/fonts/montserrat-600-normal.woff2`, `src/app/fonts/OFL-Montserrat.txt` |
| Inter | `font-sans`: body, labels, buttons, tables | 400, 700 | `rsms/inter` release **v4.1**: `Inter-Regular.woff2` and `Inter-Bold.woff2`, taken from the `Inter-4.1.zip` asset if it holds them (zip contents not verified here), otherwise from the same tag's `docs/font-files/` (listing verified); the root `LICENSE.txt` | `src/app/fonts/inter-400-normal.woff2`, `inter-700-normal.woff2`, `OFL-Inter.txt` |

- **No subsetting.** The files are committed unmodified and renamed only to the existing `<family>-<weight>-normal.woff2` pattern, which `fonts.test.ts:111` parses.
  - The README records the upstream path, tag and sha256 for each file, as it does today (`src/app/fonts/README.md:7-16`).
  - These are full-charset files, so there is no latin/latin-ext split; one face per family covers "Ștefan".
  - Unmodified files avoid the OFL rules on modified versions. Whether either family declares a Reserved Font Name was not checked (Q-CB5).
  - The download size is measured in the PR, not estimated here.
- **Loading.**
  - Two more `localFont` calls in `src/app/layout.tsx`: `montserrat` (variable `--font-product-display`) and `inter` (variable `--font-product-body`).
  - Options: `display: "swap"`, `preload: false`, `adjustFontFallback: "Arial"`. The constant names become the family names, which `e2e/fonts.spec.ts` matches.
  - With `preload: false`, a venue page never downloads them: only an element that resolves to them triggers the download.
  - `/login` keeps the preloads it has today for Bodoni and Figtree (root layout, unchanged).
- **Weights.** Montserrat 700 ("UI emphasis" on buttons and labels) is **not** loaded by default (Q-CB4, variant VC).
- **Sources:** [Montserrat v7.222 release](https://github.com/JulietaUla/Montserrat/releases/latest), [Montserrat v7.222 `fonts/webfonts`](https://github.com/JulietaUla/Montserrat/tree/v7.222/fonts/webfonts), [Montserrat v7.222 root (`OFL.txt`)](https://github.com/JulietaUla/Montserrat/tree/v7.222), [Inter v4.1 release](https://github.com/rsms/inter/releases/tag/v4.1), [Inter v4.1 `docs/font-files`](https://github.com/rsms/inter/tree/v4.1/docs/font-files), [Inter v4.1 root (`LICENSE.txt`)](https://github.com/rsms/inter/tree/v4.1).

### 3.5 Logo slots (placeholders now, the founder's files later)

All slots live in **`public/brand/costi/`**. They are served by Next from `public/`, so they are not app routes (§3.8). The proxy skips them (`src/proxy.ts:34`), so a signed-out `/login` can load them.

`src/lib/brand/costi-assets.ts` holds the paths as constants. It is the only place in `src/` that names them, and the swap never edits it.

| Slot (source file) | Shape the founder delivers | Generated files (by `scripts/brand/render-icons.ts`) | Consumers |
|---|---|---|---|
| `app-icon.svg` | square `viewBox`, full-bleed background | `icon-192.png` (192²), `icon-512.png` (512²), `apple-touch-icon.png` (180²) | manifest `icons` (`purpose: "any"`); root `metadata.icons.apple` |
| `app-icon-maskable.svg` | square, artwork inside the central 80 % safe zone, full-bleed background | `icon-maskable-192.png`, `icon-maskable-512.png` | manifest `icons` (`purpose: "maskable"`) |
| `favicon.svg` | square, legible at 16 px | `favicon-32.png` (32²) | root `metadata.icons.icon`: the SVG first, the PNG as fallback |
| `logo-horizontal.svg` | mark + wordmark, for light backgrounds | — | product header (`ProductLogo`, light), top of `main` on product pages |
| `logo-horizontal-reversed.svg` | mark + wordmark, for Forest and Charcoal | — | product header in dark (`<picture><source media="(prefers-color-scheme: dark)">`); the band logo in variant VB |
| `mark.svg` | the mark alone, light backgrounds | — | **no consumer in this plan** (reserved; the slot is filled and checked so a later screen needs no asset step) |
| `mark-reversed.svg` | the mark alone, for Forest and Charcoal | — | **no consumer** (reserved) |
| `wordmark.svg` | the wordmark alone, light backgrounds | — | **no consumer** (reserved) |
| `wordmark-reversed.svg` | the wordmark alone, for Forest and Charcoal | — | **no consumer** (reserved) |

- **E-mail template:** no slot. `auth-templates.test.ts` forbids `<img>`, `url(` and `http` in the template (`:96`, `:100-105`). Many mail clients do not show SVG, and an image needs an absolute URL. The e-mail carries "Costì" as text in the Costì colours (§3.3). A hosted PNG logo in the e-mail is not planned.
- **`ProductLogo`:** `<img alt="Costì" class="h-7 w-auto">` inside a `<picture>`. It has no `width` attribute, so it takes the file's own aspect ratio, and a replaced file with another ratio needs no code change.
- **Placeholders** (step CB5) are drawn by tdd-guide:
  - plain shapes in Forest, Coral and Off-white, with no `<text>`, so they do not depend on any font;
  - each root `<svg>` carries `data-costi-placeholder="true"`.
  - The DigiAlto-Ops placeholder SVGs (PR #58) may be used instead if the lead copies them in; they get the same marker and pass the same checks.
- **Delivery rules** the founder's files must meet; these become `public/brand/costi/README.md` and are tested:
  - root `<svg>` with a `viewBox` (square for the three icon slots);
  - no `<script>`, `<foreignObject>`, `on*` attributes, `<image>`, external `href`, `@import` or `url(http`;
  - text converted to outlines (no `<text>`);
  - no `data-costi-placeholder`.

### 3.6 Why the swap is a file-replace commit only

1. **Fixed names.** Code names only the paths in `costi-assets.ts`, which the swap keeps.
   - The manifest, `metadata.icons` and `ProductLogo` read them.
   - Sizes come from the PNG table inside the render script (unchanged) and from CSS height. No `width`/`height` of a logo is written in code.
2. **Generated PNGs are files too.** `scripts/brand/render-icons.ts` (run with `npx tsx`) renders each source SVG at each size with **Playwright's Chromium**, which is already a devDependency (`package.json:38`). It writes three kinds of file:
   - the PNGs;
   - `public/brand/costi/renders.json`: for each PNG, its source slot, its size and the **sha256 of the source SVG** it was made from;
   - `public/brand/costi/README.md`'s checksum table.
   - The swap commit = the new SVGs + the re-generated PNGs + the re-generated `renders.json` and README. These are file changes only.
3. **The tests make a half-done swap fail.** `tests/config/costi-brand-assets.test.ts` (Vitest, no browser) checks:
   - every slot exists;
   - every SVG meets the delivery rules;
   - every PNG's IHDR width and height equal its size (bytes 16-23, read with `node:fs`);
   - **each `renders.json` source hash equals the sha256 of the SVG in the tree**, so a replaced SVG without re-rendered PNGs fails.
   - The test has no list of hashes of its own, so the founder's files need no test edit.
4. **Placeholders cannot reach go-live by accident.** Go-live checklist row **BRAND-1** (step CB10) gates go-live: "no `data-costi-placeholder` in `public/brand/costi/*.svg`, unless the founder explicitly approves the placeholders for go-live". Its check: `grep -l data-costi-placeholder public/brand/costi/*.svg` must print nothing.
   - The Vitest suite does not fail on placeholders. If it did, the PR could not merge before the files arrive, and a test that passes only after a code edit would break rule 1.

### 3.7 Data model, API

No migration, no endpoint, no RLS or role change. `tests/config/ux-quick-wins-preserves.test.ts` keeps its newest-migration pin, and its `@theme` names stay equal to `COLOR_TOKENS`, because the product blocks add values and no names.

### 3.8 CSP, service worker, pre-render

- **CSP: ADR-028 stays unchanged.**
  - Fonts are served from `/_next/static/media` (`font-src 'self'`).
  - Logos, icons and the favicon come from `/brand/costi/*` (`img-src 'self'`; the manifest is `manifest-src 'self'`).
  - `<img>` and `<picture>` add no script and no inline style. SVG loaded through `<img>` runs no script, and the delivery rules forbid script anyway.
  - The `.svg`/`.png` paths are skipped by the proxy and get the static policy (decision 3). That is right for a file.
  - Guards: `e2e/security-headers.spec.ts` and `tests/config/next-config-headers.test.ts` unchanged and green. The new e2e collects CSP violations on `/login`, `/login/codice`, `/dispositivo` and `/missing.png` and expects `[]`.
- **Pre-render list.** The icons are files in `public/`, not the `app/icon.*` or `app/apple-icon.*` file conventions. Whether those conventions would add routes to `.next/prerender-manifest.json` was not verified; `public/` avoids the question, so `PRERENDERED` (`security-headers.spec.ts:139`) and the M25 doc test stay exact.
- **Service worker: no change and no manual version bump.**
  - The worker never caches `/brand/*` or the manifest (`sw.js:309-331`).
  - The cached shell pages (`/`, `/tavoli`, `/tavoli/comanda`) are refreshed network-first, and every deploy has a new `VERSION` (the commit SHA, `next.config.ts:31`) whose activate step deletes the old shell caches (`sw.js:166-186`).
  - `tests/pwa/sw-source.test.ts` and `e2e/pwa.spec.ts` stay unchanged.
  - How fast an **already installed** PWA picks up the new name and icons is up to the browser and the OS. It is not promised and not tested (risk R3).

### 3.9 The "Costì" vs "Costi" nav clash

- **Proposed label: "Costi dei piatti"** (it) / **"Plate costs"** (en).
- **It matches what `/costi` shows.** The h1 is `costs.title` "Costi dei piatti" / "Plate costs" (`costi/page.tsx:55`; `it.ts:1416`; `en.ts:1399`), and the page body is the list of plates.
- **Rejected labels:**
  - "Costi fissi" names only the owner's card (`:69`); the admin does not even see it.
  - "Costi e margini" would introduce a word the page does not use (the chef's tab is "Margini").
- **The facet link** on an ingredient row also uses `nav.costs` and opens `/costi/ingredienti` (`facet-links.ts:56-61`), so with the new nav text it would say "dei piatti" while opening ingredients. It moves to the existing key `costs.links.ingredients`, "Costi degli ingredienti" / "Ingredient costs" (`it.ts:1428`; `en.ts:1411`), which is that page's h1 (`it.ts:1461`).
- **Guard:** no nav section label, tab label or facet label equals "Costì" after removing accents and case, in either locale.

### 3.10 Sequence on `/login` (light, signed out)

```
GET /login → proxy (nonce CSP) → root layout (<html> with 6 venue + 2 product font variables; metadata title "Costì", icons)
  → (public)/layout: HeaderBand(PublicBrand → BrandLink "Osteria Dei Rossi")
  → login/layout: viewport themeColor #0E4D3A; <div data-brand="costi" class="contents"><ProductLogo/>…
CSS: :root:has([data-brand="costi"]) → product colours + font remap → body Off-white, band Forest with Coral rule,
     h1 Montserrat 600, text Inter; Montserrat/Inter woff2 downloaded on first use (/_next/static/media)
```

## 4. Alternatives considered

- **A1. Change the osteria tokens to Costì.** Rejected. Venue screens must keep the osteria look (founder decision), and phase 3 needs per-scope values.
- **A2. New token names (`--color-costi-forest` …).** Rejected:
  - every component would need product-specific classes;
  - `ux-quick-wins-preserves.test.ts:20-23` would have to change;
  - a tenant theme could not reuse the components unchanged.
  - Re-valuing the same names is the smallest design.
- **A3. Move the product pages to a new `(product)` route group with its own layout.** Cleaner in folder terms, but the `git mv` touches 15 test files that import `@/app/(public)/login/…` (Grep) and the page allowlist of `tests/config/m25b-preserves.test.ts:195-198`. Two nested layouts give the same result with no move.
- **A4. Choose the scope in the client from `usePathname` (like `PublicBrand`).** Rejected. It needs a client component for something a server layout states directly, and it cannot carry the `viewport` export.
- **A5. Load Montserrat and Inter in the nested layouts so they are preloaded only there.** Rejected. Their variables would sit on the scope `div`, not on `<html>`, so the band above it (in `(public)/layout.tsx`) would keep Bodoni. `preload: false` at the root costs the venue pages nothing.
- **A6. Icons through `app/icon.svg` / `app/apple-icon.png`.** Rejected because of the unverified effect on the pinned pre-render list (§3.8).
- **A7. PNGs through `sharp`.** Rejected. It is only Next's optional dependency (`node_modules/next/package.json:115`); declaring it fails `no-new-deps.test.ts:42-46` and needs a plan change. Playwright's Chromium renders SVG and is already pinned.
- **A8. Hand-exported PNGs.** Rejected. They cannot be reproduced, and nothing ties them to their SVG; the `renders.json` hash does.
- **A9. Subset the fonts with `pyftsubset`.** Not chosen by default (variant VE). It modifies the files (Q-CB5) and adds a tool step.

**Dependencies:** none added (`no-new-deps.test.ts` green). The render script uses `@playwright/test` and `tsx`, which are already devDependencies.

## 5. Build plan

### Split recommendation

**A separate PR, `feat/costi-product-brand`, cut from `main` right after the staff PR (`feat/ux-quick-wins-staff`) merges, with QW13 inside it.** Reasons:
1. **It would break the staff PR's own contract.** The UX quick-wins plan promises "no new colours, fonts or sizes" and no new token (`2026-11-13-ux-quick-wins.md:14-15`, `:46-47`), and its D1 preserves test documents that. This work adds two font families, three woff2 files, about ten image files and a second colour value set.
2. **Size and review focus.** The staff PR already has 11 steps. This one adds 11 more, with binary files (checksums, licences), contrast maths and CSP checks. These are different review concerns from navigation and the comanda.
3. **Rollback.** The brand can be reverted (Vercel re-promote) without undoing the waiters' fixes, and the other way round.
4. **Order.** It builds on QW1 (`HeaderBand`, `(public)/layout.tsx`, already on this branch).
   - It touches `e2e/app-shell.spec.ts` (`:203`, `:387`), which QW6, QW7 and QW4 also edit. Cutting after the staff PR avoids parallel conflicts.
5. **QW13 in this PR, not the staff PR.**
   - One identity change, deployed once.
   - The founder updates the hosted Auth template, subject and sender once, to the restyled version.
   - The client-facts record (CB1) lands first in the same PR.
   - If the lead prefers QW13 in the staff PR, see variant VA.

**Test-first rule.** As in the UX plan: each *failing-first* test is written first and fails for the stated reason; a *guard* already passes and must stay green. The e2e tests run in the 360 × 740 phone projects unless they say "laptop".

| # | Step (one commit) | Files | Failing-first test | Guards, e2e and changed assertions |
|---|---|---|---|---|
| CB1 | Product facts in `docs/client-facts.md` (exact text in §5a); this plan cross-referenced from §5.5 by a note in the PR description | `docs/client-facts.md`, `tests/config/costi-brand-docs.test.ts` | `costi-brand-docs.test.ts`: `client-facts.md` has the heading `## Product (DigiAlto)` **after** the client list and before `## Draft client data`; it contains "Product name: Costì" and the five hex values; the client "Trading name: Osteria Dei Rossi" line is unchanged (fails: no heading) | `tests/config/reservations-docs.test.ts` (reads `client-facts.md`) green |
| CB2 | **QW13 strings** (platform plan §5.5 rows 1-9 at the worktree lines): `app.name` "Costì" (`it.ts:2`, `en.ts:4`); new `venue.name` "Osteria Dei Rossi" next to it; `brand.tsx:59` and `(owner)/page.tsx:80`, `:88` → `venue.name`; `login.intro` "Entra in Costì con la tua email e la password." / "Sign in to Costì with your email and password." (`it.ts:4`, `en.ts:6`); manifest `name`/`short_name` "Costì" (`manifest.ts:7-8`); subject "Il tuo accesso a Costì" (`config.toml:257`); template `<title>` and wordmark `:6`, `:10` → Costì | `src/lib/i18n/messages/it.ts`, `en.ts`, `src/components/brand.tsx`, `src/app/(owner)/page.tsx`, `src/app/manifest.ts`, `supabase/config.toml`, `supabase/templates/magic-link.html`, `tests/lib/i18n/product-name.test.ts`, `tests/config/no-venue-literal.test.ts`, `tests/app/manifest.test.ts`, `tests/config/auth-templates.test.ts` | `product-name.test.ts`: `t("app.name")` is "Costì" and `t("venue.name")` is "Osteria Dei Rossi" in it and en (fails: no `venue.name`). `no-venue-literal.test.ts`: a TypeScript-scanner test (string-literal tokens only) finds no `"Osteria Dei Rossi"` literal in `src/` outside the `venue.name` and `brand.homeLink` entries (fails: `app.name` and `manifest.ts:7-8`). Changed on purpose: `manifest.test.ts:9-12` → "Costì"; `auth-templates.test.ts:44-46` → `'"Il tuo accesso a Costì"'`; `:91-98` "names the venue" → "names the product": contains "Costì", not "Osteria Dei Rossi", plus the same four negative checks | `brand-link.test.ts`, `brand-title.test.ts`, `public-brand.test.ts` (wordmark "Osteria Dei Rossi") unchanged and green. e2e `app-shell.spec.ts:25-33`, `:40`, `:55`, `:62` and `reservations-public.spec.ts:264` unchanged (the band stays the venue's). New in `e2e/smoke.spec.ts`: `/login` `toHaveTitle("Costì")`, the intro contains "Costì", heading "Accedi" (`:21`) and `password-login.spec.ts:61` unchanged |
| CB3 | Nav label "Costi dei piatti" / "Plate costs"; facet link label `costs.links.ingredients`; clash guard | `it.ts:1518`, `en.ts:1501`, `src/lib/nav/facet-links.ts:58`, `src/lib/costing/cost-view.ts:308` (comment), `tests/lib/nav/label-clash.test.ts` and the changed tests listed in §5c | `label-clash.test.ts`: for every `labelKey` in `nav-model.ts` sections and tabs and in `ingredientFacets` output, in it and en, `normalize("NFD")` without marks and lowercased is not `"costi"` (fails: `nav.costs` is "Costi") | §5c lists each changed assertion; all stay exact. `expectPhoneFriendly` in `app-shell.spec.ts` (Registro row, Altro page) proves the longer pill wraps without sideways scroll |
| CB4 | Product tokens: `PRODUCT_BRAND` (the five colours), `PRODUCT_DERIVED` (the `mix()` shades of §3.3), `PRODUCT_THEMES`; the two `globals.css` blocks (colours only) | `src/lib/design/tokens.ts`, `src/app/globals.css`, `tests/lib/design/tokens.test.ts` | `tokens.test.ts`, new cases: (a) `PRODUCT_THEMES` has exactly `COLOR_TOKENS` in both themes; (b) **every `CONTRAST_PAIRS` entry passes in both product themes** (`it.each`); (c) each `PRODUCT_DERIVED` literal equals its `mix()` formula; (d) Coral (`gold`, `highlight`) is under 4.5 on product `paper`; (e) the `:root:has([data-brand="costi"])` light block and its dark twin equal `PRODUCT_THEMES` and come after the osteria dark block; (f) the status tones equal the osteria `THEMES` values (fails: no export, no block). **Changed on purpose:** `:209-213` "declares no colour token outside those two blocks" becomes "outside the two osteria blocks and the two product blocks" (the new blocks are checked exactly by (e), so nothing goes unchecked) | `ux-quick-wins-preserves.test.ts:20-23` green (no new `@theme` name). All existing osteria cases unchanged. `kitchen-contrast.test.ts` unchanged |
| CB5 | Logo slots with placeholders, the paths module and the render script | `public/brand/costi/{app-icon,app-icon-maskable,favicon,logo-horizontal,logo-horizontal-reversed,mark,mark-reversed,wordmark,wordmark-reversed}.svg`, the six PNGs of §3.5, `public/brand/costi/renders.json`, `public/brand/costi/README.md` (slots, consumers, delivery rules, checksums), `src/lib/brand/costi-assets.ts`, `scripts/brand/render-icons.ts`, `tests/config/costi-brand-assets.test.ts` | `costi-brand-assets.test.ts`: each of the nine SVG slots exists and meets the delivery rules of §3.5 (the marker rule excepted); the icon slots have a square `viewBox`; each PNG exists with the IHDR size of its slot; `renders.json` lists exactly the six PNGs and each source hash equals the SVG's sha256; `costi-assets.ts` names exactly these paths; no other `src/` file contains `/brand/costi/` (fails: no files) | Self-tests inside the same file: a fixture SVG with `<script>`, one with `onload=` and one with `<text>` are each refused; a PNG with a wrong IHDR is refused; a changed SVG byte makes the hash check fail (on temporary copies in `os.tmpdir()`). The script is run by tdd-guide (`npx tsx scripts/brand/render-icons.ts`) and its output committed |
| CB6 | Manifest colours and icons; favicon and apple icon in the root metadata | `src/app/manifest.ts`, `src/app/layout.tsx` (`metadata.icons`), `tests/app/manifest.test.ts`, `tests/app/root-metadata.test.ts` | `manifest.test.ts` (changed on purpose): `theme_color` `#0E4D3A`, `background_color` `#F7F8F6` (both from `PRODUCT_THEMES`); `icons` equals exactly `[192 any, 512 any, 192 maskable, 512 maskable]` with the `costi-assets.ts` paths, `type: "image/png"` and `sizes` matching the IHDR; the "no icons key (Q121)" case is replaced by this exact list (fails: old colours, no icons). `root-metadata.test.ts`: `metadata.icons.icon` is `[favicon.svg (image/svg+xml), favicon-32.png (32x32)]` and `apple` is `apple-touch-icon.png` (fails: no icons) | `m25b-preserves.test.ts:203-209` green. `manifest.test.ts:14-19` unchanged. `security-headers.spec.ts:139` pre-render list unchanged. `public/sw.js` unchanged (no diff; `sw-source.test.ts` green) |
| CB7 | Product fonts, the scope, the layouts and `ProductLogo` | `src/app/fonts/{montserrat-600-normal,inter-400-normal,inter-700-normal}.woff2`, `src/app/fonts/OFL-Montserrat.txt`, `OFL-Inter.txt`, `src/app/fonts/README.md`, `src/app/layout.tsx` (two `localFont` calls, two variables on `<html>`), `src/app/globals.css` (font remap in the product light block), `src/components/product-scope.tsx`, `src/app/(public)/login/layout.tsx`, `src/app/(public)/dispositivo/layout.tsx`, `tests/lib/design/fonts.test.ts`, `tests/components/product-scope.test.ts`, `e2e/product-brand.spec.ts`, `e2e/fonts.spec.ts` | `fonts.test.ts` (made stricter): `FONT_FILES` gains the three files and each licence (`OFL-Montserrat.txt`, `OFL-Inter.txt` contain "SIL Open Font License, Version 1.1"); `swap` × 6 (was 4, `:77`); `preload: false` × 4 (was 2, `:91`); weights: montserrat 600 only, inter 400 and 700 only (`:105-120` extended); the product block remaps exactly the four variables to `--font-product-display` / `--font-product-body` (fails: files absent). `product-scope.test.ts`: renders `data-brand="costi"`, a `picture` whose `source` has `media="(prefers-color-scheme: dark)"` and the reversed path, and an `img` with `alt="Costì"`, no `width` attribute and `h-7` (fails: no module). Layout source test: both layouts export `viewport.themeColor === PRODUCT_THEMES.light.band` and wrap `children` in `ProductScope`; neither `(public)/layout.tsx` nor any file under `(public)/prenota/` contains `data-brand` or `ProductScope` (fails: no layouts) | **New `e2e/product-brand.spec.ts` (stack-free, like `smoke.spec.ts`):** on `/login`, `/login/codice` and `/dispositivo`: body background `rgb(247, 248, 246)`, `header.band` background `rgb(14, 77, 58)`, exactly one `meta[name=theme-color]` with `#0E4D3A`, `img[alt="Costì"]` visible with a 200 response, title "Costì", CSP violations `[]`; `emulateMedia({ colorScheme: "dark" })` → body `rgb(31, 41, 51)`, the dark logo source chosen; `GET /missing.png` (404 under the static policy, ADR-028 decision 3) keeps the osteria body `rgb(255, 250, 223)` and requests no Montserrat or Inter file. **`e2e/fonts.spec.ts` changed on purpose:** `/login` must load faces matching `/montserrat/i` and `/inter/i`; the first family of the h1's computed stack matches `/montserrat/i` and the body's `/inter/i`; every woff2 is same-origin `/_next/static/media` with 200 (`:50-59` kept). The Bodoni Moda and Figtree loaded-face check moves to `/missing.png` (the venue 404). `e2e/reservations-public.spec.ts` unknown-address test: also asserts the body background stays `rgb(255, 250, 223)`. `app-shell.spec.ts`: on signed-in `/` the body is still `rgb(255, 250, 223)` and the title is "Costì". `smoke.spec.ts:25-40` (44 px and no sideways scroll on `/login`) green with the new fonts |
| CB8 | Staff e-mail in the Costì colours (inline styles only; words from CB2) | `supabase/templates/magic-link.html`, `tests/config/auth-templates.test.ts` | `auth-templates.test.ts`, new case: the template's colours are exactly the e-mail pairs of §3.3 (body `#F7F8F6`, card `#FFFFFF`, text `#1F2933`, wordmark `#0E4D3A`, button `#0E4D3A` with `#FFFFFF`, footnote `#555D64`, top border `#FF7A5C`); each text pair is ≥ 4.5 with `contrastRatio`; no osteria-only or old hex (`#7a1f1f`, `#b08d3c`, `#f6f1e8`) remains (fails: old colours) | `:69-105` unchanged and green (no `<img>`, no `url(`, no `http`, the two variables only, Italian) |
| CB9 | ADR-042 "Product theme scope": the same token names re-valued under a scope attribute; contract for phase 3 | `docs/adr/adr-042-product-theme-scope.md`, `tests/config/costi-brand-docs.test.ts` | `costi-brand-docs.test.ts`: ADR-042 exists, names `data-brand`, `PRODUCT_THEMES`, `CONTRAST_PAIRS` and at least one rejected alternative (A2) (fails: no file). Number: the next free one after the staff PR's ADR-041; if taken at build time, the next free number, and the test follows | `code-reviewer` checks it against `templates/adr.md` |
| CB10 | Docs: `ui-foundation.md` gains "§11 Product theme (Costì)" (token table, pairs, fonts, slots, the scope rule) and its §9 logo and PWA-icon TODOs (`:395-402`) point to it for the product; go-live checklist rows **BRAND-1** (no placeholder logo files at go-live, the `grep` of §3.6) and **BRAND-2** (the founder updates the hosted Auth template, subject and SMTP sender name "Costì"; §5.5 `:718-720`) in "Other items" (`docs/go-live/checklist.md:86-93`) | `docs/design/ui-foundation.md`, `docs/go-live/checklist.md`, `tests/config/costi-brand-docs.test.ts`, `tests/config/go-live-docs.test.ts` | `costi-brand-docs.test.ts`: ui-foundation §11 exists and its token table equals `PRODUCT_THEMES` (parsed); `go-live-docs.test.ts`: rows BRAND-1 and BRAND-2 exist, owner founder, status open, BRAND-1 quotes the check command (fails: no rows) | `go-live-docs.test.ts` existing cases green |
| CB11 (later, file-replace only) | **The founder's logo files:** replace the nine SVGs in `public/brand/costi/`, run `npx tsx scripts/brand/render-icons.ts`, commit the SVGs, PNGs, `renders.json` and README checksums. No file under `src/`, `tests/`, `e2e/` or `scripts/` changes | `public/brand/costi/*` only | No new test. It is proven by the CB5 test, which **fails** if any SVG breaks a delivery rule or if a PNG was not re-rendered (hash mismatch), and by the CB7 e2e (logo 200, CSP `[]`). The BRAND-1 `grep` prints nothing. The PR description states the `git diff --stat` touches `public/brand/costi/` only. The founder checks the maskable safe zone by eye | All suites green. The founder ticks BRAND-1 in the checklist (a doc edit by the lead, not part of the swap commit) |

### 5a. Exact text for `docs/client-facts.md` (CB1)

Inserted after line 22 ("Booking hours per service") and its paragraph `:24-28`, before "Not approved" (`:30`):

```markdown
## Product (DigiAlto)

Product facts, not client facts: they belong to DigiAlto's product **Costì**, of which Osteria Dei Rossi is tenant #1. The client
facts above stay the venue's. Source: DigiAlto-Ops `knowledge/agency/products/costi/brand.md`, relayed by the lead (founder
decisions 2026-11-13).

- Product name: Costì (founder-approved 2026-11-13, before go-live; shown where the product speaks, platform plan §5.5)
- Product colours (hex): Forest #0E4D3A (primary), Coral #FF7A5C (accent: accents, icons and large graphics only, never text),
  Sage #DCEDE6 (support), Off-white #F7F8F6 (background), Charcoal #1F2933 (text) (founder-approved 2026-11-13)
- Product fonts: Montserrat (headings and UI emphasis), Inter (body and tables), self-hosted (founder-approved 2026-11-13)

Not approved (product): the Costì logo. The founder will send the vector files; until then the app ships placeholders
(`public/brand/costi/`, go-live row BRAND-1). No product tagline, price or claim is approved.
```

### 5b. Variants

Each variant is triggered by an open question in §7. Other sections refer to them only by ID.

**VA — QW13 strings ship in the staff PR** · Trigger: the lead keeps QW13 in `feat/ux-quick-wins-staff` (Q-CB1) · Replaces: CB1 and CB2 move there, and CB2 runs before the staff PR's last commit
| # | Step | Files | Test that proves it |
|---|---|---|---|
| VA.1 | CB1 as written, on the staff branch | as CB1 | as CB1 |
| VA.2 | CB2 as written, on the staff branch; `QW13` added to the `SHIPPED` list and its strategy row marked Done | as CB2, plus `tests/config/ux-quick-wins-docs.test.ts`, `docs/plans/2026-11-13-ux-strategy.md` | the CB2 tests, plus `ux-quick-wins-docs.test.ts`: the QW13 row says `Done (PR 2)` |

**VB — Costì in the band on the sign-in pages** · Trigger: Q-CB2 answered "Costì in the band on `/login*`" · Replaces: the band brand on `/login*` (CB7); `/dispositivo` keeps the venue
| # | Step | Files | Test that proves it |
|---|---|---|---|
| VB.1 | `PublicBrand` renders `ProductBandLogo` (the `logo-horizontal-reversed.svg` slot, `alt="Costì"`, no link) on `/login` and `/login/*`, and the venue link elsewhere; `ProductLogo` is dropped from the login layout | `src/app/(public)/public-brand.tsx`, `src/lib/nav/public-paths.ts` (`isProductSignInPath`), `src/components/product-scope.tsx`, `src/app/(public)/login/layout.tsx` | `public-paths.test.ts`: `/login`, `/login/codice` true; `/dispositivo`, `/prenota/x` false. e2e `product-brand.spec.ts`: `/login`'s `header.band` has `img[alt="Costì"]` and no "Osteria Dei Rossi" text; `/dispositivo`'s band still has the venue link. `app-shell.spec.ts:25-33` changes to: on `/login` and `/pin` the band has `img[alt="Costì"]` **and** no `a[href="/"]` (presence plus absence, the same strictness) |

**VC — Montserrat for UI emphasis (buttons, labels)** · Trigger: Q-CB4 answered "yes" · Replaces: the CB7 weights (adds Montserrat 700)
| # | Step | Files | Test that proves it |
|---|---|---|---|
| VC.1 | Add `montserrat-700-normal.woff2` (v7.222 `Montserrat-Bold.woff2`); in the product scope, `button, label > span:first-child` take `font-family: var(--font-product-display)` | `src/app/fonts/*`, `src/app/fonts/README.md`, `src/app/layout.tsx`, `src/app/globals.css` | `fonts.test.ts`: montserrat weights are exactly 600 and 700. e2e `product-brand.spec.ts`: the "Accedi con la password" button's first computed family matches `/montserrat/i`; on `/missing.png` no button uses it |

**VD — `/prenota` keeps the venue's tab title** · Trigger: Q-CB6 answered "venue name in the guest tab" · Replaces: nothing (adds after CB2)
| # | Step | Files | Test that proves it |
|---|---|---|---|
| VD.1 | `src/app/(public)/prenota/[slug]/page.tsx` and `annulla/page.tsx` export `metadata = { title: t("venue.name") }` | those two files | e2e `reservations-public.spec.ts` unknown-address test: `toHaveTitle("Osteria Dei Rossi")`; `product-brand.spec.ts`: `/login` still "Costì" |

**VE — Subset the product fonts** · Trigger: Q-CB5 answered "subset" · Replaces: the CB7 font files (same names)
| # | Step | Files | Test that proves it |
|---|---|---|---|
| VE.1 | Subset with `pyftsubset` (fonttools, a one-off Python tool, not an npm dependency) to Google's latin plus latin-ext ranges (the `LATIN_EXT_RANGE` of `fonts.test.ts:17-18` plus Basic Latin); the README records the command and both checksums (upstream and subset) | `src/app/fonts/*`, `src/app/fonts/README.md` | `fonts.test.ts`: each product file is smaller than its upstream size recorded in the README. e2e `product-brand.spec.ts`: a name with "Ș" in a `/login` field renders with the product face (`document.fonts.check('16px inter', 'Ș')`) |

### 5c. Existing assertions that change (each stricter or equal)

| Spec or test (file:line) | Step | Before | After | Why it is not weaker |
|---|---|---|---|---|
| `tests/app/manifest.test.ts:9-12` | CB2 | names "Osteria Dei Rossi" | "Costì" | exact |
| `tests/app/manifest.test.ts:21-28` | CB6 | osteria colours, no `icons` | product colours from `PRODUCT_THEMES`, exact icon list | exact, and more is asserted |
| `tests/config/auth-templates.test.ts:44-46`, `:91-98` | CB2 | venue subject, "names the venue" | product subject, contains "Costì" and not "Osteria Dei Rossi"; the four negative checks kept | exact plus an absence check |
| `tests/lib/design/tokens.test.ts:209-213` | CB4 | no colour outside 2 blocks | no colour outside 4 named blocks, each checked exactly | every declared colour is still checked |
| `tests/lib/design/fonts.test.ts:8-15`, `:62-71`, `:77`, `:91`, `:105-120` | CB7 | 6 files, 4 swap, 2 no-preload | 9 files with licences, 6 swap, 4 no-preload, weights per family | exact counts |
| `e2e/fonts.spec.ts:35`, `:65-78` | CB7 | `/login`: Bodoni and Figtree | `/login`: Montserrat and Inter (first family in the stack); `/missing.png`: Bodoni and Figtree loaded | each family still proven loaded, on the page where it applies; first-family check is stricter than today's loose stack match |
| `e2e/app-shell.spec.ts:387` | CB3 | sidebar list `"Costi"` | `"Costi dei piatti"` | exact list |
| `e2e/app-shell.spec.ts:203` | CB3 | `hasText: /^Costi$/` | `/^Costi dei piatti$/` | anchored |
| `e2e/costs.spec.ts:158` | CB3 | nav link "Costi" (exact) is current | "Costi dei piatti" (exact) is current | exact |
| `e2e/costs.spec.ts:335`, `:454` | CB3 | no nav link "Costi" (exact) | no nav link "Costi dei piatti" (exact) | keeping "Costi" would pass trivially; the new name keeps the absence meaningful |
| `tests/components/app-shell.test.ts:97` | CB3 | `"Costi"` in the Registro row | `"Costi dei piatti"` | exact list |
| `tests/components/altro-page.test.ts:76` | CB3 | `"Costi"` | `"Costi dei piatti"` | exact list |
| `tests/components/nav-full-load.test.ts:29`, `:42`, `:52` | CB3 | `link("Costi")` | `link("Costi dei piatti")` | same assertion |
| `tests/lib/nav/facet-links.test.ts:24` | CB3 | `"nav.costs"` | `"costs.links.ingredients"` | exact list |
| `tests/components/facet-links.test.ts:124`, `:128`, `:147`, `:148`, `:156`, `:160`, `:223`, `:227`, `:235` | CB3 | "Costi" link and `Costi -> /costi/ingredienti#…` | "Costi degli ingredienti", same hrefs | exact; the chef's absence check (`:235`) uses the new name |

Label-only (no assertion, renamed for clarity): `tests/components/empty-screens.test.ts:93` (case name used in `describe.each` `:129`), and the test titles at `facet-links.test.ts:121`, `:132`, `:164`, `:231` and `tests/lib/nav/today-actions.test.ts:172`. `docs/guides/` has no "Costi" (Grep), so no guide changes.

## 6. Risks and mitigations

- **R1. The product theme leaks onto a venue screen, or the reverse.** `:root:has` re-values every token while a `data-brand` element is in the page.
  - Mitigation: only two layouts render it (source test in CB7).
  - e2e checks the osteria background on `/missing.png`, `/prenota` (unknown address) and signed-in `/`, and the product background on three product pages.
  - After a client navigation from `/login` to `/`, the scope element unmounts and `:has` stops matching. The sign-in success path is covered by the existing `password-login.spec.ts` flow, which lands on Home; CB7 adds a body-colour check there.
- **R2. Font flash on `/login`.** `preload: false` means Montserrat and Inter swap in after first paint. `adjustFontFallback: "Arial"` limits the shift. `smoke.spec.ts:25-40` keeps the 44 px and no-sideways-scroll checks. The visual effect is accepted for a sign-in page. VE or a later preload can change it; no timing is promised.
- **R3. Installed PWAs.** Already installed apps may keep "Osteria Dei Rossi" and the generic icon until the browser or OS refreshes the manifest. Whether and when that happens is platform behaviour and was not verified here.
  - The deploy note in the PR tells the founder that removing and re-adding the app from the home screen applies it at once.
  - The training session (G3-4) should happen after this deploy (Q-CB7).
- **R4. Logo files from outside the repo.** SVG can carry script.
  - Mitigation: the delivery rules and the CB5 test refuse script, `foreignObject`, `on*`, external references and `<image>`.
  - SVG is only ever loaded through `<img>`, and the files are served under the static CSP.
- **R5. Licences.** OFL texts are committed next to the files (CB7). The files are unmodified, unless VE.
- **R6. "Costì" vs "Costi" for screen readers.** After CB3 no visible label is "Costi" (guard test). "Costì" appears only where the product speaks (§3.1).
- **R7. Hand-computed ratios.** The tests are the authority (CB4). If a computed value in §3.3 is off, the test result wins and the table in ui-foundation §11 (CB10) is written from the test output.
- **Security and privacy:**
  - **No new origin and no third-party request.** Fonts and logos are self-hosted, ADR-028 is unchanged and Google hosts stay forbidden (`fonts.test.ts:28-39`, `e2e/fonts.spec.ts:18-30`).
  - **No personal data is touched.** The e-mail keeps only its two variables (`auth-templates.test.ts:79-82`).
  - **Secrets: none added.**
    - App secrets stay in Vercel environment variables, database secrets in Supabase Vault, and CI secrets in GitHub environments.
    - The Resend SMTP credentials and the sender display name live only in the hosted Supabase Auth settings (checklist S8-3, `docs/go-live/checklist.md:38`).
    - Account logins stay in the founder's password manager.
  - **Waiters and costs.** No screen gains a cost. The nav label change keeps `canReadCosts` (`nav-model.ts:137`) and the chef and waiter absence checks (`costs.spec.ts:335`, `:454`, with the new name).
- **Performance and cost:** three more woff2 files, downloaded only on product pages; up to nine SVG and six PNG files. Sizes are reported in the PR, not estimated.

## 7. Open questions for the lead and founder

| # | Question | Default |
|---|---|---|
| Q-CB1 | QW13 strings in this PR or in the staff PR? | **This PR** (§5, "Split", reason 5). VA if the staff PR |
| Q-CB2 | On `/login*`, does the band keep the venue's name (§5.5 FD34) or show Costì? | **Venue's name in the band**, Costì logo and intro in the page. VB if Costì in the band |
| Q-CB3 | Approve the derived product shades (white surface; the `mix()` shades; the dark product theme: Charcoal paper, Sage action, Forest band)? | **As in §3.3**; any change is a token edit re-checked by CB4 |
| Q-CB4 | "UI emphasis" in Montserrat: headings only, or buttons and labels too? | **Headings, the band wordmark and the login h1** (Montserrat 600 only). VC for buttons and labels |
| Q-CB5 | Fonts: commit the full upstream files, or subset them (a modified font; whether Montserrat or Inter declares a Reserved Font Name was not checked)? And Montserrat from the v7.222 release (2017; the repository has newer commits) or a newer source? | **Full, unmodified files; Montserrat v7.222 and Inter v4.1**, as the brand file says ("official GitHub releases"). VE to subset |
| Q-CB6 | Guest booking tab title: "Costì" (§5.5, `<title>` everywhere) or the venue's name? | **Costì** (as §5.5). VD for the venue's name |
| Q-CB7 | Deploy timing: before the waiter training session (G3-4) and outside service hours 11:00–24:00, as for the quick wins? | **Yes**; you set the date, none is promised here |
| Q-CB8 | May the PR merge with placeholder logos, go-live being blocked by BRAND-1 until your files arrive? | **Yes**: merge with placeholders; CB11 is a file-replace commit; BRAND-1 blocks go-live |
| Q-CB9 | Logo file delivery: nine SVGs (app icon, maskable icon, favicon, horizontal, horizontal reversed, mark, mark reversed, wordmark, wordmark reversed) to the rules of §3.5, text as outlines, maskable artwork inside the central 80 %. Is a separate favicon drawing coming, or should the favicon slot reuse the app icon? | **Separate slot**; if no favicon drawing comes, the app icon file is copied into the favicon slot (still a file-only change) |
| Q-CB10 | Hosted settings (BRAND-2): the founder updates the Supabase Auth template, the subject "Il tuo accesso a Costì" and the SMTP sender display name "Costì" after merge | **Yes**, in the same session as the deploy |
| Q-CB11 | Whether "Costì" is free to use as a product and domain name (platform plan `:1483`) | Not checked; no claim made. For the founder |
