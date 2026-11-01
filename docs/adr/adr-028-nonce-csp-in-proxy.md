# ADR-028: The Content-Security-Policy is built per request in the proxy, with a nonce; every HTML page is rendered dynamically; the static headers stay in `next.config.ts`

- **Status:** proposed
- **Date:** 2026-11-01
- **Decided by:** architect, on the M25 plan (`docs/plans/2026-11-01-m25-go-live.md`). Awaiting the founder's approval with the plan.

## Context

- **Project plan §3.11.6:** "CSP (no inline scripts except Next.js nonce-based ones; `connect-src` limited to self, Supabase, Sentry), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `frame-ancestors 'none'`, HSTS on production."
- **M0 deferred the full CSP to M25** (M0 plan, risks: "only `frame-ancestors` in M0. The full nonce CSP comes in M25").
- **What exists on `main` `0f1df68`:**
  - `src/lib/security-headers.ts` returns static headers: `nosniff`, `Referrer-Policy`, `Content-Security-Policy: frame-ancestors 'none'`, `X-Frame-Options: DENY`, and HSTS (`max-age=63072000; includeSubDomains`) only when `VERCEL_ENV` is `production` at build time.
  - `next.config.ts` applies them to `/:path*`.
  - `src/proxy.ts` (Next.js 16 proxy) runs `updateSession` on every path except static files, `sw.js` and the manifest.
- **Constraints the CSP must respect, recorded by earlier plans:**
  - M4: the invoice document panel frames a short-lived signed URL from the Supabase Storage origin (`<iframe>` for PDFs, `<img>` for photos), so `frame-src` and `img-src` must allow that origin.
  - M20: `worker-src 'self'`, `manifest-src 'self'`, and `/sw.js` stays same-origin.
  - The UI foundation: fonts are self-hosted by `next/font` (`font-src 'self'`), and there are no third-party scripts.
  - The browser never calls Supabase directly: there is no `createBrowserClient` in `src/`, and every screen reads `/api/*`. Sentry is server-side only (M0 Q-D).
- **Next.js inlines small bootstrap scripts.** A CSP without `'unsafe-inline'` must either give them a per-request nonce or hash them. A nonce must be new on every response, so a page that carries one cannot be prerendered once and served from a static cache.

## Decision

1. **One pure builder, `src/lib/security/csp.ts`.** `buildCsp({ nonce, supabaseOrigin, deployment, dev })` returns the policy:
   - `default-src 'self'`;
   - `script-src 'self' 'nonce-<n>' 'strict-dynamic'`, plus `'unsafe-eval'` only under `next dev`;
   - `style-src 'self' 'nonce-<n>'`;
   - `img-src 'self' <supabase>`, `frame-src <supabase>`;
   - `font-src 'self'`, `connect-src 'self'`, `worker-src 'self'`, `manifest-src 'self'`;
   - `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`;
   - `upgrade-insecure-requests` on Vercel deployments (production and preview) only.
2. **The proxy sets it on every response it handles.**
   - `updateSession` creates a 128-bit nonce for each request.
   - It forwards the policy (and `x-nonce`) on the request, so Next.js can put the nonce on its own scripts.
   - It sets the policy on the response, redirects included.
3. **Every HTML page renders dynamically.** The root layout opts out of static prerendering, so no page is served without a fresh nonce.
4. **The static headers stay in `next.config.ts` for every path**, including the paths the proxy skips:
   - `nosniff`, `Referrer-Policy` and `X-Frame-Options: DENY`;
   - HSTS on production, with the M0 value.

   `Content-Security-Policy` leaves the static list, so a response never carries two policies.
5. **No CSP reporting endpoint for now.** Violations surface in the browser console and in the tests: every Playwright spec runs under the policy, and the service simulation fails on any violation.

## Alternatives

- **Keep a static CSP in `next.config.ts` with `script-src 'self' 'unsafe-inline'`.**
  - Pros: static pages stay static; no proxy change.
  - Cons: `'unsafe-inline'` removes most of the protection a CSP gives against injected script.
  - Why not: the project plan asks for a nonce-based policy.
- **Hashes instead of a nonce (Next.js's experimental subresource-integrity support).**
  - Pros: pages could stay static.
  - Cons: experimental in the framework; the hashes change with every build; this session could not check the current status in the Next.js documentation.
  - Why not: a production security control should not rest on an experimental flag.
- **Build the CSP inside each route or layout.**
  - Why not: it must also cover redirects and API replies. The proxy already runs on exactly those paths and already owns the session refresh.
- **A report-only phase first (`Content-Security-Policy-Report-Only`).**
  - Why not: without a reporting endpoint, report-only shows nothing in production. The full Playwright suite plus the simulation's violation collector is the rehearsal instead. A reporting endpoint stays possible later (M25 Q191).

## Consequences

- **Good:**
  - no inline script runs without the nonce of its own response;
  - the policy has one source and one unit test;
  - the header-check script (M25 AT2) reads the same directives from a live deployment.
- **Bad / accepted trade-offs:**
  - **No HTML page is prerendered any more.** Each page view costs a function invocation. The PRD's 2-second dashboard target is re-measured with the existing staging workflows before go-live, and no number is promised here.
  - The service worker's cached shell pages keep the nonce of the response they were cached from, together with that response's own policy. They stay self-consistent, but the nonce of a cached page is reused while it is served offline. The cache holds three shell pages and is replaced on every online navigation.
  - `style-src` has no `'unsafe-inline'`. A future component that renders an inline `style` attribute on the server would be blocked; the violation collector in the e2e suite catches it.
- **What would make us revisit this:**
  - Next.js offering stable hash-based CSP for static pages;
  - a measured page-load regression against the PRD target;
  - a need for third-party scripts (browser Sentry, analytics), which would add origins;
  - a CSP reporting requirement.
