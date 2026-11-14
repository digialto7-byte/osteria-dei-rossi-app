# ADR-045 — One Costì design system; the venue is a layer

- **Status:** accepted (supersedes ADR-042 decisions 2 and 3)
- **Date:** 2026-11-14 · **Decided by:** founder (2026-11-14, via the lead; plan `docs/plans/2026-11-14-ux-p2-design-system.md`, D1 to D3, D7)

## Context
- ADR-042 gave the product surfaces the Costì look through a scope attribute and left the venue screens on the osteria look. It also
  said a tenant theme would be a full value set for every colour token (phase 3).
- The founder decided on 2026-11-14 that the whole app is one Costì design system (`docs/ux/costi-design-system.md` §1). A venue is a
  layer on top of it with exactly three settings: a name, an optional logo and one accent colour (§9). Strategy decision D2 (the osteria's
  own palette and fonts) is superseded.
- A per-tenant palette would have needed a theme table, an API and an inline `<style>` per page. One accent needs none of them.
- Constraints: no new dependency, no new token name, the CSP header unchanged (ADR-028), print stays light, no flash on first paint.

## Decision
1. **One system.** Every screen moves to the Costì values, one route group at a time, with `CostiTheme` (a hidden marker that the existing
   `:root:has([data-brand="costi"])` blocks react to) as the switch. When the last group is done, the Costì values become the `:root`
   default and the osteria theme, its fonts and the marker are deleted. This supersedes ADR-042 decision 2 (only the product surfaces
   render the scope).
2. **The venue layer is three settings.** `Venue` is `{ name, logo | null, accent }`, parsed by `venueSchema`. The name is text, the logo
   is a same-origin path, the accent is a `#RRGGBB` value. Nothing else is configurable. This supersedes ADR-042 decision 3 (a tenant
   theme as a full `COLOR_TOKENS` value set).
3. **The accent re-values one token.** `--color-band` is set from the accent and `--color-band-ink` is derived from it, as two custom
   properties on the band's `<header>` element, for every venue band from the first slice (signed-in shell and guest band, `/prenota`
   included). The Coral rule under the band and every other token stay Costì. Product pages get no layer and stay Forest.
4. **`venueLayer(accent)` validates in code.** Band-ink is Off-white or Charcoal, whichever contrasts more (a tie gives Off-white). It
   returns a typed refusal, never a substitute colour: `band_ink_contrast` when neither reaches 4.5:1, otherwise `rule_contrast` when
   Coral against the accent is under 3:1. A malformed hex throws. `requireVenueBand` throws `VenueLayerRefused` on a refusal.
5. **The contract for SP9.** SP9 stores `name`, `logo` and `accent`, validates with `venueSchema` and `venueLayer()` when saving,
   refuses with the refusal code, and serves the `Venue`. Until then `VENUE_LAYER_DEFAULT` (in `src/lib/design/venue-layer.ts`) holds
   the osteria's values: the approved green `#1C4130`, no logo.
6. **CSP.** The header is unchanged. The band's two custom properties are a `style` attribute, which `style-src 'self' 'unsafe-inline'`
   already allows (ADR-028, decision on `style-src`, and its rejection of a nonce there). Only two hex values from `venueLayer()` reach
   that attribute, only on `<header>`; the name is rendered as text and the logo `src` must be a same-origin path (`img-src 'self'`).

## Alternatives
- **A1. A `globals.css` block per venue.** Rejected: one deploy per tenant.
- **A2. An inline `<style>` per layout (the strategy's DS5).** Rejected: it would be page-wide, and a tenant could reach every token.
- **A3. A `/theme.css` route.** Rejected: an extra request and a cache question for two values.
- **A4. A `tenant_theme` table with a full palette per tenant (the strategy's DS4, ADR-042's contract).** Rejected: the founder's scope is
  three settings; the contrast guarantee is then two rules on one colour instead of a gate on 25 tokens per tenant. Storage is SP9's.
- **A5. Clamp or darken an invalid accent.** Rejected: a silent fallback colour. The editor is told why and chooses another colour.
- **A6. A band per slice.** Rejected: one band path, one look everywhere from the first slice.

## Consequences
- Good: one set of components and tokens for every venue; a tenant cannot break contrast, status colours or the primary action; no new
  token, endpoint, dependency or CSP change.
- Bad / accepted trade-offs: for the weeks while route groups move one at a time, a client navigation between a re-skinned group and one
  not yet re-skinned flips the page values (the band is uniform from the first slice). In dark mode the band goes from the osteria's
  `#16301F` to `#1C4130`, and the band's ink from cream to Off-white. Every accepted accent gets Off-white ink, because Coral reaches 3:1
  only on a band too dark for Charcoal to reach 4.5:1.
- What would make us revisit this: a venue that needs more than a name, a logo and one colour, or a venue whose brand colour no accent
  passes both rules.
