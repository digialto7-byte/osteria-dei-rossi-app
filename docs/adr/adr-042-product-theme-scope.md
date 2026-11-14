# ADR-042 — Product theme scope: the same token names, re-valued under a scope attribute

- **Status:** accepted
- **Date:** 2026-11-13 · **Decided by:** founder (the Costì product brand, 2026-11-13; plan `docs/plans/2026-11-13-costi-product-brand.md`, lead decisions of the same day)

## Context
- The app is tenant #1 of DigiAlto's product Costì. The founder approved the product look (Forest, Coral, Sage, Off-white, Charcoal; Montserrat and
  Inter) for the product surfaces only: the sign-in pages, the device page, the staff e-mail, the manifest and the icons. The venue's screens
  (Home, Sala, Cucina, `/prenota/*`, guest e-mails) keep the osteria look.
- Every colour in the app is a design token (`COLOR_TOKENS`, 25 names in `src/app/globals.css`, mirrored in `src/lib/design/tokens.ts`), and
  `tests/lib/design/tokens.test.ts` checks every `CONTRAST_PAIRS` entry in both themes. The UX quick-wins plan promised no new token.
- Phase 3 (per-tenant themes) needs the same thing again: a second set of values for the same components.
- Constraints: no new dependency, no per-component product classes, the header band above the page content must follow the look, no flash on
  first paint, print stays light, dark mode follows the device.

## Decision
1. **The same token names, a second value set.** `PRODUCT_THEMES` (`src/lib/design/tokens.ts`) has exactly the `COLOR_TOKENS` names, light and
   dark, with the Costì values. Coral takes `gold` and `highlight` (already accent-only: never text). The status tones keep the osteria values.
2. **A scope attribute, switched on by the server.** `globals.css` re-values the tokens under `:root:has([data-brand="costi"])` (specificity
   (0,2,0), which beats `:root` and next/font's variable classes), in a light block and, limited to `screen`, a dark block, both after the
   osteria dark block. In the same light block the four font variables are remapped to the product faces. Only two server layouts render
   `<ProductScope>` (`data-brand="costi"`): `(public)/login/layout.tsx` and `(public)/dispositivo/layout.tsx`. Because the variables sit on
   `<html>`, the band, `body` and `color-scheme` all follow, and the browser needs no script.
3. **The contract for phase 3.** A theme (the product's or a tenant's) is a full value set for `COLOR_TOKENS`. It must pass every
   `CONTRAST_PAIRS` entry in both themes (a test per theme, like `PRODUCT_THEMES` has), its mirrored CSS block must equal it exactly, and it is
   applied by a scope attribute, never by editing the osteria values. Whether a tenant theme is another value of `data-brand` or values read
   from the tenant record is for SP9; nothing here assumes it.
4. **Guards.** `tokens.test.ts` checks the two product blocks against `PRODUCT_THEMES` and that no colour is declared outside the four named
   blocks. A source test keeps `data-brand` and `ProductScope` out of `(public)/layout.tsx` and `(public)/prenota/*`, and the e2e specs check
   the osteria background on a missing address, the booking page and signed-in Home.

## Alternatives
- **A1. Change the osteria tokens to Costì.** Not chosen: venue screens must keep their look, and phase 3 needs per-scope values.
- **A2. New token names (`--color-costi-forest` and so on).** Rejected: every component would need product-specific classes, the pinned list
  of `@theme` names in `ux-quick-wins-preserves.test.ts` would have to change, and a tenant theme could not reuse the components unchanged.
  Re-valuing the same names is the smallest design.
- **A3. A `(product)` route group with its own layout.** Not chosen: moving the sign-in pages touches 15 test files that import
  `@/app/(public)/login/…` and the page allowlist of `m25b-preserves.test.ts`; two nested layouts give the same result with no move.
- **A4. Choose the scope in the client from `usePathname`.** Rejected: it needs a client component for something a server layout states
  directly, and it cannot carry the `viewport` export (the Forest theme colour).
- **A5. Load the product fonts in the nested layouts.** Rejected: their variables would sit on the scope `div`, so the band above it would keep
  Bodoni. At the root with `preload: false` they cost a venue page nothing.

## Consequences
- Good: no new token name, no component change, one mechanism for the product look and for per-tenant themes; the contrast guarantee is
  tested per theme; the venue's screens are untouched and guarded.
- Bad / accepted trade-offs: while a `data-brand` element is in the page every token is re-valued, so a venue screen must never render one (the
  source and e2e guards). The dark product values are derived, not given by the brand file. `:has()` needs a current browser (already used in
  `globals.css`). After a client navigation from the sign-in to Home the scope unmounts and the osteria values return (checked in e2e).
- What would make us revisit this: a tenant theme that needs more than colours and two fonts, a need for a product look inside a signed-in
  screen, or a browser target without `:has()`.
