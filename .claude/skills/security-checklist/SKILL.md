---
name: security-checklist
description: Use before shipping code or a site that handles user input, auth, payments, personal data, file uploads, third-party APIs or secrets - a practical security checklist for DigiAlto web and software projects.
---

# Security checklist

Go through every section that applies. Each "no" is a finding to fix before release.
`code-reviewer` uses this list; `architect` designs for it.

## Secrets
- [ ] No keys, tokens or passwords in code, tests, fixtures, logs or git history.
- [ ] Secrets come from environment variables or the host's secret store; `.env` is gitignored,
      `.env.example` has fakes only.
- [ ] Keys are scoped to the minimum (read-only where possible) and rotatable.

## Input and output
- [ ] Every external input is validated by type, length, format and range, server-side.
- [ ] SQL uses parameterised queries or the ORM; no string-built queries.
- [ ] No shell commands built from input; if unavoidable, pass an argument list, never a string.
- [ ] HTML output is escaped by the framework; no `innerHTML`/`dangerouslySetInnerHTML` with
      unsanitised data; no `eval`, `new Function` or string timers (the write hooks flag these).
- [ ] File uploads: type and size checked, stored outside the web root, renamed, never executed.
- [ ] Redirects only to allow-listed destinations.

## Auth and access
- [ ] Passwords hashed with a slow algorithm (argon2/bcrypt) or delegated to a provider.
- [ ] Sessions/cookies: `HttpOnly`, `Secure`, `SameSite`; tokens expire.
- [ ] Every endpoint checks authorisation for the specific resource (no IDOR).
- [ ] Rate limiting on login, signup, password reset, contact forms and any costly endpoint.
- [ ] Admin areas not discoverable by default; MFA where the platform offers it.

## Web
- [ ] HTTPS only; HSTS on production.
- [ ] Security headers: `Content-Security-Policy`, `X-Content-Type-Options: nosniff`,
      `Referrer-Policy`, `frame-ancestors`/`X-Frame-Options`.
- [ ] CORS limited to known origins; no `*` with credentials.
- [ ] State-changing requests protected against CSRF (SameSite cookies or tokens).
- [ ] Forms post only to destinations approved in the client profile; spam protection on
      public forms.
- [ ] Third-party scripts only when the brief needs them, loaded from the vendor's official
      domain, with SRI where versioned.

## Personal data (GDPR for EU clients)
- [ ] Collect only what the feature needs; state why in the privacy text the client supplies.
- [ ] No tracking or non-essential cookies before consent (and only if the profile says
      tracking is approved).
- [ ] Personal data never in logs, URLs or error messages; deletion is possible on request.

## Dependencies and deploy
- [ ] `npm audit` / `pip-audit` (or equivalent) has no high/critical issues, or each is
      explained.
- [ ] Error pages and API errors don't expose stack traces or versions.
- [ ] Backups exist for anything holding client or customer data.

Report format: `- [FAIL] <area> — <file:line or URL> — <risk> — <fix>`.
