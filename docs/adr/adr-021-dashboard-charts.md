# ADR-021: Dashboard charts as hand-written inline SVG with a table or text alternative

- **Status:** proposed
- **Date:** 2026-10-28 · **Decided by:** founder (on `docs/plans/2026-10-28-owner-dashboard.md`)

## Founder answers recorded with this decision (2026-10-28)

- **Q106:** the owner's Oggi (`/`) is the dashboard. To-dos (UX PR B's block) sit at the top and the tiles below. There is no separate "Cruscotto" section, and PR B merges first.
- **Q107:** the admin lands on the same dashboard, with no fixed-cost keys and no tile derived from fixed costs. pgTAP proves the omission. The founder left this to DigiAlto; the DigiAlto lead decided.
- **Q108:** the chef gets no dashboard and keeps the action-list Oggi.
- **Q109:** waste € covers the current ISO week, Monday to Sunday, Europe/Rome.
- **Q110:** the worst five plates are ranked by how far GP % is below the target. Plates with an incomplete cost are listed separately ("costo incompleto") and not ranked.

## Context

**What the dashboard needs to draw.** The tiles show:
- GP % per plate against its target, for the worst five plates;
- waste € of the week, by reason;
- the menu's food cost % as one value from 0 to 100.

That is two kinds of chart: a short list of horizontal bars, with an optional target mark, and a single meter.

**Constraints**
- PRD: phone first; the dashboard loads in under 2 s on a phone over 4G (NFR); Italian UI; accessible.
- `docs/design/ui-foundation.md`:
  - colours from tokens only, light and dark through CSS variables;
  - colour never carries a meaning alone;
  - no images, no icon fonts, no `data:` URIs, **no inline `style` attributes**, no third-party origins (§7);
  - 44 px targets, no sideways scroll at 360 px.
- The future CSP keeps `style-src 'self'` plus a nonce (§3).
- Project invariant: every screen reads `/api/*`, and there is no data logic in React components.
- Rule of the project (§3.12): every dependency needs a reason. None was added for UI so far.

## Decision

**Two small chart components, hand-written as inline SVG in React, drawn from the API's numbers.** No chart library.

- **`BarTable`** is a real `<table>`, with a `<caption>`, a row header per item and the value as text. Each row has a bar cell holding an `<svg aria-hidden="true" focusable="false" viewBox="0 0 100 8" preserveAspectRatio="none">` with three parts:
  - a track `rect`;
  - a value `rect`, whose `width` is a percentage;
  - an optional target `line`.
- **`Meter`** is one aria-hidden SVG bar, next to the visible figure and its hint.

**The text is the accessible content.** Each SVG is decoration of a number that is already printed next to it, in a table or a sentence. Screen readers read the table; sighted users get the bar as well. Below target is shown by:
- the bar colour;
- **and** a `Badge` word ("Sotto obiettivo");
- **and** the printed percentage.

**Geometry is a pure helper,** `src/lib/charts/scale.ts`: `barPct` clamps to 0–100, `tickPct` handles the target. The components only place it. The values, ranking and windows come from SQL through `GET /api/dashboard`.

**Colours are token utilities:** `fill-accent`, `fill-danger`, `fill-sunk`, `stroke-ink`.
- Dark mode follows the existing CSS variables, so the charts contain no theme code.
- New non-text contrast pairs (`danger`/`surface`, `ink`/`sunk`) go into `CONTRAST_PAIRS` and are tested in both themes.
- In `forced-colors` mode, a CSS block maps the bars to `CanvasText` and `Canvas`.

**Size attributes, not styles.** The SVG `width`, `x` and `x1` presentation attributes carry the geometry, so no `style` attribute and no runtime CSS is needed. That keeps the ui-foundation rule and the future CSP.

**Guarded by tests (plan step 10):**
- every `<svg>` is `aria-hidden` and `focusable="false"`;
- the markup has no `style=`, `<image`, `<foreignObject`, `data:` or palette class;
- the values are present as text.

## Alternatives

- **Recharts (React + SVG).**
  - Pro: ready-made axes, tooltips and responsive containers.
  - Con: a runtime dependency with its own transitive dependencies, for two simple bar shapes.
  - Con: its default output relies on hover tooltips, which are poor on a phone and for keyboard users, and it would still need our own table for accessibility.
  - Not chosen.
- **Chart.js or ECharts (canvas).**
  - Pro: rich, fast with many points.
  - Con: canvas pixels carry no text and no DOM, so a full parallel table is needed anyway.
  - Con: canvas does not follow the CSS token variables for dark mode or forced colours without extra code.
  - Con: a larger download on the dashboard, against the 2 s target.
  - Not chosen.
- **CSS-only bars (`div`s with a width).**
  - Pro: no SVG at all.
  - Con: a width taken from data needs an inline `style` attribute or generated classes, which ui-foundation §7 rules out and the nonce-based CSP would have to allow. A fixed set of width classes (0–100) works but rounds and adds CSS.
  - Not chosen.
- **Server-rendered images (PNG or SVG files, `<img>` or `data:` URIs).**
  - Con: forbidden by ui-foundation (no images, no `data:`).
  - Con: needs alt text that repeats the numbers, and does not follow the theme.
  - Not chosen.
- **The native `<meter>` and `<progress>` elements.**
  - Pro: built in, with semantics.
  - Con: the styling of their parts differs across browsers, the target mark cannot be drawn, and a tested contrast in dark mode is hard to get.
  - Not chosen. The SVG meter is a few lines.
- **No charts, numbers only.**
  - Pro: the simplest option.
  - Con: the founder asked for charts, and a bar against a target is faster to read at arm's length than a column of percentages.
  - Not chosen. The numbers stay as the primary content anyway.

## Consequences

**Good**
- No new dependency. Nothing extra to download, audit or upgrade.
- One accessible source per chart: the table or text, which is also what tests and screen readers read.
- Light, dark and forced colours work through the existing tokens.
- No inline styles, so the future CSP stays strict.

**Bad, and accepted trade-offs**
- No axes, gridlines, tooltips or animation. If a later report needs time series (M22 KPIs by day, covers per hour), a line or column chart is new work: a third component, or a library chosen then with this ADR revisited.
- Bars are proportional to a fixed 0–100 % domain for percentages and to the largest value for €. The relative scale for € is stated in the table caption.
- `preserveAspectRatio="none"` stretches the drawing. The target mark uses `vector-effect="non-scaling-stroke"` so that its width stays 1 px.

**What would make us revisit this**
- A report needing more than about a dozen points per chart, or time axes (M22 trends, M32 forecast).
- A founder request for interactive charts (zoom, hover details).
- A measured dashboard load that misses the 2 s target because of rendering. This is unlikely with static SVG, but the M22 page-load test would show it.

## References

- Plan: `docs/plans/2026-10-28-owner-dashboard.md` §3.4 (components, tokens, accessibility), §5 steps 9–11 and 14 (tests).
- `docs/design/ui-foundation.md` §2 (tokens and contrast), §7 (do and don't).
- MDN `forced-colors`: <https://developer.mozilla.org/en-US/docs/Web/CSS/@media/forced-colors>.
- Tailwind CSS fill and stroke utilities: <https://tailwindcss.com/docs/fill>, <https://tailwindcss.com/docs/stroke>.
