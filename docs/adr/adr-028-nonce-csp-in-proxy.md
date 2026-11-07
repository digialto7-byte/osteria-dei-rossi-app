# ADR-028: A strict Content-Security-Policy with a per-request nonce set in the proxy; every app page renders per request

- **Status:** accepted (founder, 2026-11-01, second round of M25 answers: "the strict policy").
- **Date:** 2026-11-01 (first proposed); rewritten 2026-11-03 for the founder's second answer. · **Decided by:** founder.
- **Author:** architect, on the M25 plan (`docs/plans/2026-11-01-m25-go-live.md`, §3.1.1, steps 2, 2a, 2b, 4, 4a, 21).
- **File name (decided):** this file goes back to its first name, `docs/adr/adr-028-nonce-csp-in-proxy.md`. M25 step 2 did `git mv docs/adr/adr-028-static-csp.md docs/adr/adr-028-nonce-csp-in-proxy.md` in the same commit as the code.
  - **Why rename and not just retitle:** the name `static-csp` would describe the opposite of the decision. Nothing links to the file by path except the M25 plan, which step 2 updated.
- **History:** proposed as a nonce policy (`f6e87e5`), then rewritten to a static policy with `'unsafe-inline'` after the founder's first answer (`b430cff`, built in `596b9d6`). The founder then reversed that (second round), so it is a nonce policy again. Superseded text is in git history.

## Context

- **Project plan §3.11.6:** "CSP (no inline scripts except Next.js nonce-based ones; `connect-src` limited to self, Supabase, Sentry), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `frame-ancestors 'none'`, HSTS on production." M0 deferred the full CSP to M25.
- **The founder's second answer (2026-11-01):** the residual risk of `script-src 'unsafe-inline'` is not accepted. `script-src` uses a per-request nonce set in the proxy, so pages render per request. The PR measures and reports the effect on the M18/M22 performance targets and on Vercel Hobby usage.
- **What is on the branch now** (`feat/m25-go-live`, with `main` `b215326` merged in at `8fcdda6`):
  - `596b9d6` built the static policy: `buildCsp({ supabaseOrigin, deployment, dev })` in `src/lib/security/csp.ts`, sent from `next.config.ts` on `/:path*` through `securityHeaders()`.
  - It also built two guards: `tests/guards/no-raw-html.test.ts` and `tests/guards/no-browser-supabase.test.ts`.
  - `src/proxy.ts` calls `updateSession()` (`src/lib/supabase/proxy.ts`). That refreshes the Supabase session, ends sessions older than 30 days (ADR-029) and sends signed-out page visits to `/login`. Its matcher covers every page and `/api/*`, and excludes `_next/static`, `_next/image`, `favicon.ico`, `sw.js`, `manifest.webmanifest` and image files.
  - `src/app/layout.tsx` is synchronous and reads no request data. Only `/login` reads `headers()`.
- **What runs in the browser:**
  - **No inline script of ours.** There is no `dangerouslySetInnerHTML`, no `next/script` and no `<script>` in a layout; the guard keeps it so.
  - **Next.js's own scripts:** the bootstrap, the inline `self.__next_f.push(...)` flight scripts and the `/_next/static` chunks.
  - **One inline style attribute:** `style={{ width }}` in `src/components/cost/plate-breakdown.tsx`.
  - **No browser call to Supabase**, and one cross-origin frame: the invoice document panel frames or shows a signed Supabase Storage URL.
- **How Next.js uses a nonce** (Next.js CSP guide, `docs/01-app/02-guides/content-security-policy.mdx` on `canary`, read from GitHub because nextjs.org is not reachable from this session):
  - "Next.js parses the `Content-Security-Policy` header and extracts the nonce using the `'nonce-{value}'` pattern." The header in question is the **request** header that the proxy passes on.
  - Next applies the nonce to framework scripts, page bundles and the inline scripts it generates.
  - `x-nonce` is a request header for **our** code to read through `headers()`. Next itself does not need it.
  - "When you use nonces in your CSP, all pages must be dynamically rendered." Static optimisation and ISR are disabled, and the guide lists slower initial loads, more server load, no CDN caching and higher hosting costs.
  - The guide's example is `script-src 'self' 'nonce-…' 'strict-dynamic'`, plus `'unsafe-eval'` in development "because React uses eval to provide enhanced debugging information".
- **`'strict-dynamic'`** (MDN `script-src`, read from `mdn/content` on GitHub):
  - The trust given to a nonced script "shall be propagated to all the scripts loaded by that root script".
  - Allowlist sources such as `'self'` and `'unsafe-inline'` "will be ignored".

## Decision

1. **The policy is built per request, in the proxy, with a fresh nonce.**
   - `createNonce()` (`src/lib/security/nonce.ts`) returns 16 bytes from `crypto.getRandomValues`, base64 encoded (24 characters, 128 bits).
   - The guide's `btoa(crypto.randomUUID())` is not used. A v4 UUID carries 122 random bits, below the 128 we require.
2. **Page responses** (every path the proxy matches, except `/api/*`) get this policy:

   | Directive | Value | Why |
   |---|---|---|
   | `default-src` | `'self'` | Anything not listed is same-origin only |
   | `script-src` | `'self' 'nonce-<n>' 'strict-dynamic'`, plus `'unsafe-eval'` only when `NODE_ENV === "development"` (`next dev`) | **No `'unsafe-inline'` in any served build.** Inline scripts run only if Next stamped this response's nonce on them. Chunks that a nonced script loads are trusted through `'strict-dynamic'`. `'self'` is ignored by CSP3 browsers and kept as the fallback for older ones |
   | `style-src` | `'self' 'unsafe-inline'` | A nonce in `style-src` would make browsers ignore `'unsafe-inline'`, and a nonce cannot cover a `style=""` attribute. The app's own bar width in `plate-breakdown.tsx` would then be blocked. A style injection cannot run script. Q234 asks whether to go further (variant V2) |
   | `img-src` | `'self' <supabase-origin>` | Invoice photos from Storage |
   | `frame-src` | `<supabase-origin>` | The invoice PDF iframe (Storage, cross-origin) |
   | `font-src` | `'self'` | `next/font` self-hosts |
   | `connect-src` | `'self'` | The browser calls only `/api/*` (guard test) |
   | `worker-src`, `manifest-src` | `'self'` | The service worker and the manifest |
   | `object-src` | `'none'` | No plugins |
   | `base-uri` | `'self'` | No `<base>` hijack |
   | `form-action` | `'self'` | Forms post only to us |
   | `frame-ancestors` | `'none'` | No clickjacking |
   | `upgrade-insecure-requests` | on Vercel production and preview only | On `http://localhost` it would rewrite the local Storage URLs |

   - The proxy sets the policy and `x-nonce` on the **request** it forwards, which is how Next finds the nonce.
   - It sets the same policy on the **response**, redirects included.
   - `<supabase-origin>` is the origin of `NEXT_PUBLIC_SUPABASE_URL`, read at runtime.
   - The deployment comes from `VERCEL_ENV` at runtime (`"development"` when unset).
3. **Responses without a nonce get a static policy:** `/api/*` (matched by the proxy, but the proxy skips the nonce there), `/sw.js` and `/manifest.webmanifest` (not matched), and **every other request the proxy's matcher skips**: `/_next/static`, `/_next/image` and `favicon.ico` (prefix matches, as in the matcher) and any path ending in `.svg|.png|.jpg|.jpeg|.gif|.webp|.ico`.
   - The policy is the same directive list with `script-src 'self'` (plus `'unsafe-eval'` under `next dev`), and never `'unsafe-inline'`.
   - It is sent from `next.config.ts` rules, one policy per path. The skipped-path sources are `/:path((?:_next/static|_next/image|favicon\.ico).*)` and `/:path((?!api/|_next/static|_next/image|favicon\.ico).*\.(?:svg|png|jpg|jpeg|gif|webp|ico))`. The second excludes `api/` and the prefixes so that no path matches two rules (a duplicate `Content-Security-Policy` is a `multiple_csp` finding of the header check).
   - **Why the skipped paths need it:** a request the proxy skips can still reach the root layout. `GET /missing.png` matches no file, so Next renders not-found through the layout, and without a policy that document would have none. The extension list in `next.config.ts` and the one in the proxy matcher are compared by `tests/config/next-config-headers.test.ts`, which fails if they differ.
   - `/:path*` keeps `nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY` and HSTS (production) but carries **no** CSP, so no response has two policies.
   - The service worker's own CSP comes from its script response, and it needs only `connect-src 'self'`.
4. **Every app page renders per request.** The root layout (`src/app/layout.tsx`) becomes `async` and calls `nonceOrNull(await headers())`.
   - `headers()` is a request-time API, so the whole tree under the root layout is rendered per request.
   - `nonceOrNull` returns the nonce, or `null` when `x-nonce` is absent, which happens only for a request the proxy skipped (decision 3). The layout then renders without a nonce: Next's inline scripts carry none, and the static policy from `next.config.ts` (no `'unsafe-inline'`, no nonce in `script-src`) blocks them, so the page fails closed and shows its static content. A not-found under a skipped path (`/missing.png`) is therefore a clean **404 under the static policy**, not a 500.
   - An `x-nonce` that is **present but empty or malformed** still throws `csp_nonce_missing`. The proxy overwrites the header on every request it handles, so such a value is tampering or a bug, and a page must not render under it.
   - Not only not-found pages render this way. A dynamic route with an image-like last segment (`/fatture/x.png`, `/tavoli/a.svg`) also skips the proxy and renders its page shell under the static policy, with status 200 and no sign-in redirect. Scripts are blocked and today's pages are client components that read `/api/*`, so nothing leaks; but a future server component that reads data must not assume it always sits behind the proxy (and its session check).
   - (Earlier text: the layout called `requireNonce`, which threw on a missing header. That turned `GET /missing.png` into a 500 with no policy at all, because the proxy had skipped it and the `/:path*` rule has no CSP.)
   - The routes that stay pre-rendered are `/manifest.webmanifest`, a metadata route outside the root layout, and Next.js 16's static `/_global-error` fallback (see Consequences). The build check in M25 step 4 holds the list `["/_global-error", "/manifest.webmanifest"]` exactly.
5. **The proxy keeps its duties.** Session refresh, the 30-day end of session and the sign-in redirects are unchanged. The matcher's coverage is unchanged (M25 only escaped the dot in `favicon\.ico`, which had also skipped paths such as `/faviconXico`), so `/api/*` and prefetch requests still pass through the proxy for authentication.
   - The proxy matcher is case-sensitive and next.config's header sources are not, so an uppercase path such as `/X.PNG` or `/API/x` matches both. On `next start` the proxy's policy replaces the static one (the same header set twice), so one policy is sent; none of these paths serves a real asset or route.
   - The Next.js guide excludes `api` and prefetches from its matcher. We do not, because the proxy refreshes sessions on `/api/*` and redirects signed-out navigations.
6. **The service worker's offline shell stays valid.** A cached shell page is a complete `Response`: the HTML plus the headers it was served with, including the policy carrying the nonce of that same render.
   - Served offline, the document's policy and its inline scripts carry the same nonce, so it is self-consistent.
   - The worker never edits a cached page. Its own "Sei offline" page gets a fixed policy with no script at all (step 4a).
7. **Unchanged from M0:** `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and HSTS on production (`max-age=63072000; includeSubDomains`, no `preload`).
8. **Guards** (built in `596b9d6`, kept):
   - no raw-HTML sink and no `next/script` in `src/`;
   - no `createBrowserClient` in `src/`;
   - every Playwright spec runs under the policy, and the CSP-violation collector must find `[]`.
9. **No CSP reporting endpoint** (Q191).

## Alternatives

- **The static policy with `'unsafe-inline'` (built in `596b9d6`).**
  - Pros: pages stay pre-rendered and served from the CDN.
  - Cons: an HTML-injection bug would run script.
  - Why not: the founder does not accept that residual risk (second round).
- **Hashes in a static header.** The flight scripts differ per page and per build, so a header fixed at build time cannot list them. One hash would also switch off `'unsafe-inline'` for all the unhashed scripts.
- **Next.js's experimental SRI** (`experimental.sri`). It hashes JavaScript files at build time, not the inline flight scripts, and it is experimental.
- **No `'strict-dynamic'` (`'self' 'nonce-<n>'` only).**
  - The chunks are same-origin, so `'self'` would load them too.
  - Rejected because with `'self'` honoured, any parser-inserted `<script src="/…">` from our own origin would run. The documented Next.js example, which the framework is tested against, uses `'strict-dynamic'`.
  - The violation collector proves the choice either way (T1).
- **A nonce in `style-src`.** This would block the existing `style=""` attribute, because nonces do not apply to attributes and `'unsafe-inline'` would be ignored. Offered as variant V2 (Q234), not the default.
- **The guide's matcher** (no `/api`, no prefetches). Rejected: it would stop session refresh on `/api/*` and the sign-in redirects for prefetches (decision 5).
- **`await connection()` instead of `headers()` in the root layout.** It is equivalent for dynamic rendering. `headers()` is chosen because the same call lets the layout fail closed when the proxy did not run.
- **`require-trusted-types-for 'script'`.** Not verified with Next.js 16 and React 19, and a trial needs reporting (Q191). Revisit together with Q191.

## Consequences

- **Good:**
  - inline-script injection is blocked by the browser, not only by React escaping and the guards;
  - no external script can load;
  - exfiltration routes stay narrowed (`connect-src 'self'`, `img-src` and `frame-src` limited to self and Supabase, `form-action 'self'`);
  - one builder, unit tests, a live header check and a browser check.
- **Bad / accepted trade-offs:**
  - **No app page is pre-rendered.**
    - Every document and client-side navigation request now runs a server render (a function invocation and CPU on Vercel).
    - The first byte waits for the render.
    - The effect on the dashboard target (< 2 s on throttled 4G, M22) and on Hobby usage is measured in M25 step 21. It is reported to the founder with a stop rule; no figure is promised.
  - **Residual risk: `style-src 'unsafe-inline'` (Q234, founder and lead decision 2026-11-03: the default stands, no style nonce).**
    - Inline `style=""` attributes and `<style>` elements are allowed on every page, because a nonce in `style-src` would make browsers ignore `'unsafe-inline'` and block the existing `style={{ width }}` in `plate-breakdown.tsx`.
    - An injected style cannot run script. What it can do is change how a page looks, and leak through CSS `url()` requests only as far as `img-src` and `font-src` allow (self and the Supabase origin).
    - Accepted; recorded in the security walk (step 20). Variant V2 in the plan (§5b) is the way to tighten it later.
  - **Requests the proxy skips render without a nonce.** A missing static asset or image (`/missing.png`) renders not-found through the root layout with no nonce, under the static policy of decision 3. Its inline scripts are blocked and it is a 404. The cost is one more block of `headers()` rules in `next.config.ts`, kept in step with the proxy matcher by a test, and a static policy on `/_next/static` chunks and images (harmless: a CSP on a script or image is not applied to the loading document).
  - **Next.js 16 also pre-renders `/_global-error`**, its static fallback for a server error, so the pre-render list is `["/_global-error", "/manifest.webmanifest"]` (lead decision, M25 step 4). Its scripts carry no nonce, so the policy blocks them and it fails closed. Accepted on one condition: the page is useful without JavaScript. `src/app/global-error.tsx` is a static Italian message, a plain `<a href="/">` link and a reload hint; a retry button may stay in addition. `e2e/security-headers.spec.ts` pins the list exactly. The list is pinned to the CI (Turbopack) build; if CI differs, the CI list wins.
  - A cached offline shell replays the nonce of the render it was cached from. That is safe, because the page is fixed bytes from our server and new responses always get a new nonce. It does mean the nonce of a cached page is not single-use on that device.
- **What would make us revisit this:**
  - step 21 hitting its stop rule;
  - Next.js offering stable hashes for inline scripts on pre-rendered pages, or a nonce that is compatible with partial pre-rendering;
  - a need for third-party scripts or a browser Supabase client;
  - a CSP reporting requirement;
  - any XSS finding.
