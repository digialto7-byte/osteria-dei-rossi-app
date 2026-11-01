# ADR-028: A static Content-Security-Policy without a nonce; pages stay pre-rendered; `script-src` keeps `'unsafe-inline'` and the residual risk is documented

- **Status:** superseded before acceptance. On 2026-11-01 the founder chose the strict per-request nonce policy instead (plan §7, second round). This ADR is rewritten for the nonce design when M25 resumes.
- **Date:** 2026-11-01 (revised the same day after the founder's M25 answers)
- **Decided by:** architect, on the M25 plan (`docs/plans/2026-11-01-m25-go-live.md`).
  - The founder chose a lighter policy without a per-request nonce, so static pre-rendering is kept (2026-11-01, through the lead).
  - The file name is kept for link stability; the nonce design it first proposed was not adopted.

## Context

- **Project plan §3.11.6:** "CSP (no inline scripts except Next.js nonce-based ones; `connect-src` limited to self, Supabase, Sentry), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `frame-ancestors 'none'`, HSTS on production." M0 deferred the full CSP to M25.
- **What exists on `main` `0f1df68`:**
  - `src/lib/security-headers.ts` returns static headers for every path through `next.config.ts`: `nosniff`, `Referrer-Policy`, `Content-Security-Policy: frame-ancestors 'none'`, `X-Frame-Options: DENY`, and HSTS on production builds.
  - The proxy (`src/proxy.ts`) only refreshes the session.
- **The founder's decision (2026-11-01):** no per-request nonce. Pages that Next.js can pre-render stay pre-rendered. A nonce would force every page to render per request.
- **What runs in the browser (read from `src/` on `0f1df68`):**
  - **No inline script of ours.** There is no `dangerouslySetInnerHTML`, no `next/script`, and no `<script>` in a layout.
  - **Next.js's own inline scripts.** The App Router writes a small bootstrap and then one or more `self.__next_f.push([...])` "flight" scripts that carry the page's React Server Components payload.
    - Their text is that page's data, so it differs per page and per build, and per request on dynamic pages.
    - A header fixed at build time in `next.config.ts` cannot list their hashes.
  - **The browser never calls Supabase.** There is no `createBrowserClient`, and every screen reads `/api/*`. Sentry is server-side only (M0 Q-D).
  - **The invoice document panel is cross-origin.** It frames a signed **Supabase Storage** URL (`<iframe>` for PDFs, `<img>` for photos), not a same-origin page. So `frame-src` and `img-src` need the Supabase origin.
    - `frame-ancestors` only controls who may frame *our* responses, so `'none'` does not affect the panel. The Storage response carries Supabase's own headers.
  - **Fonts are self-hosted** by `next/font`.
  - **The service worker** (`/sw.js`) is same-origin and fetches same-origin only.
- **A CSP rule that decides the design:** when a `script-src` holds a hash or a nonce, browsers ignore `'unsafe-inline'` in it (CSP Level 2 and later). Adding a hash for the one constant bootstrap script would therefore block every unhashed flight script.

## Decision

1. **One static policy, built by a pure function `buildCsp({ supabaseOrigin, deployment, dev })`** in `src/lib/security/csp.ts`, and sent by `securityHeaders()` on every path from `next.config.ts`. No proxy change.

   | Directive | Value | Why |
   |---|---|---|
   | `default-src` | `'self'` | Anything not listed below is same-origin only |
   | `script-src` | `'self' 'unsafe-inline'` (plus `'unsafe-eval'` only under `next dev`) | **No hash or nonce can cover Next.js's per-page flight scripts in a static header.** No `'unsafe-eval'` in any build that is served. No external script origin |
   | `style-src` | `'self' 'unsafe-inline'` | Framework-generated inline styles cannot be hashed statically either. A style injection cannot run script |
   | `img-src` | `'self' <supabase-origin>` | Invoice photos from Storage |
   | `frame-src` | `<supabase-origin>` | The invoice PDF iframe (Storage, cross-origin). Nothing else may be framed |
   | `font-src` | `'self'` | `next/font` self-hosts |
   | `connect-src` | `'self'` | The browser calls only `/api/*`. A guard test keeps a browser Supabase client out of `src/`. If one is ever added, its origin is added here in the same change |
   | `worker-src`, `manifest-src` | `'self'` | The service worker and the manifest (M20) |
   | `object-src` | `'none'` | No plugins |
   | `base-uri` | `'self'` | No `<base>` hijack |
   | `form-action` | `'self'` | Forms post only to us |
   | `frame-ancestors` | `'none'` | No clickjacking (as M0) |
   | `upgrade-insecure-requests` | only on Vercel production and preview builds | On `http://localhost` it would rewrite the local Storage URLs |

2. **`X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` and HSTS** (production builds: `max-age=63072000; includeSubDomains`, no `preload`) stay as built in M0.
3. **Guards that make the residual risk smaller and keep the policy true:**
   - no `dangerouslySetInnerHTML`, no assignment to `innerHTML`/`outerHTML`, no `insertAdjacentHTML`, no `document.write` and no `next/script` in `src/`;
   - no `createBrowserClient` in `src/`;
   - every Playwright spec runs under the policy, and the service simulation fails on any CSP violation.
4. **Pre-rendering is kept:** the set of pre-rendered routes after a build equals the set on `main` before M25.
5. **No CSP reporting endpoint** (M25 Q191).

## Residual risk (stated plainly)

- **`script-src` allows `'unsafe-inline'`.** If a bug ever let an attacker put HTML into one of our pages, an injected inline `<script>` or event-handler attribute **would run**. The CSP does not stop that.
- **What still limits it:**
  - **Injection itself is closed by construction.** React escapes every text value, and the guards above forbid every raw-HTML sink in `src/`. Invoice text and model output are rendered as text (project plan §3.11.5).
  - **No external script can load:** `script-src` names no other origin, so `<script src="https://evil…">` is blocked.
  - **Exfiltration through the page's own requests is narrowed:**
    - `connect-src 'self'`, so no `fetch`/XHR/WebSocket elsewhere;
    - `img-src` only ourselves and Supabase;
    - `form-action 'self'`;
    - `frame-src` only Supabase.

    A top-level navigation to an attacker's address cannot be stopped by any CSP directive browsers support today.
  - **Cookies are `HttpOnly`,** so an injected script cannot read the session. It could still act as the user through our own `/api/*` while the page is open, within that user's role. The roles are enforced in Postgres.
  - **`object-src 'none'`, `base-uri 'self'` and `frame-ancestors 'none'`** close the plugin, base-hijack and clickjacking routes.

## Alternatives

- **A per-request nonce set in the proxy (this ADR's first version).**
  - Pros: `'unsafe-inline'` removed from `script-src`.
  - Cons: every page renders per request (no pre-rendering), with a function invocation per page view.
  - Why not: the founder chose to keep pre-rendering (2026-11-01).
- **Hashes of the inline scripts in the static header.**
  - The flight scripts differ per page and per build (and per request on dynamic pages), so a header fixed in `next.config.ts` cannot list them.
  - A hash for the constant bootstrap alone would make browsers ignore `'unsafe-inline'` and block every flight script.
  - Generating per-route headers after each build would be fragile and would still fail on dynamic pages.
- **Next.js's experimental subresource integrity.** It covers external chunks, not inline scripts, and it is experimental.
- **`require-trusted-types-for 'script'`.** It would block raw-HTML sinks even with `'unsafe-inline'`, but whether Next.js 16 and React 19 run under it is not verified. A report-only trial needs a reporting endpoint, which we do not have. Revisit together with Q191.
- **`connect-src 'self' <supabase-origin>`.** It would allow a call the app never makes. `'self'` alone is stricter, and the guard test keeps it true.

## Consequences

- **Good:**
  - pages stay pre-rendered and cacheable;
  - the policy has one source, one unit test and one live check (the header-check script);
  - external scripts, plugins, framing and most exfiltration routes are closed.
- **Bad / accepted trade-offs:**
  - inline-script injection is mitigated by React and the guards, not by the CSP (above);
  - inline styles are allowed;
  - the policy is fixed at build time, so the Supabase origin comes from the build's `NEXT_PUBLIC_SUPABASE_URL` (each environment builds with its own).
- **What would make us revisit this:**
  - Next.js offering stable hashes or SRI for inline flight scripts on pre-rendered pages;
  - a need for third-party scripts or a browser Supabase client (new origins);
  - a CSP reporting requirement;
  - any XSS finding.
