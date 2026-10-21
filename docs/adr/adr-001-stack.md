# ADR-001 — Next.js PWA on Vercel with Supabase (Postgres, Auth, Storage, Realtime, Cron)

- **Status:** proposed
- **Date:** 2026-10-21 · **Decided by:** founder

## Context
- The PRD (`knowledge/clients/osteria-dei-rossi/sources/prd-2026-10-21.md`, "Architecture and tech stack") asks for these properties. All of them are unverified client facts in `profile.md`:
  - serverless, one repo, nothing hosted at the venue;
  - one codebase for owner, waiter and kitchen;
  - installable on phones without an app store, with an offline order queue;
  - Italian UI, EU hosting;
  - a JSON API behind every screen, so a Phase 3 assistant can reuse it;
  - roles enforced in Postgres;
  - running cost under €50/month for one venue;
  - one developer.
- The PRD proposes Next.js 15 (App Router), TypeScript, Tailwind PWA on Vercel; Supabase Postgres with RLS and `tenant_id`; Vercel Cron + pg_cron; Claude API; Google Drive polling; Resend; Supabase Auth; Sentry.
- Verified on 2026-10-21:
  - **Next.js 16 is the current stable major.** It was released 2025-10-21 and 16.3 was announced 2026-08-03 ([nextjs.org/blog](https://nextjs.org/blog)). A third party reports Next 15 end of life around 2026-10-21 ([versionlog](https://versionlog.com/nextjs/)); this is not confirmed by Vercel.
  - **Vercel Hobby crons run at most once a day.** Hourly and 15-minute expressions fail deployment ([Vercel cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)). The PRD needs a 15-minute Drive poll and hourly alert rules.
  - **Vercel Hobby is for non-commercial personal use only.** Paid contractor work counts as commercial use ([Hobby plan](https://vercel.com/docs/plans/hobby), [fair use](https://vercel.com/docs/platform/fair-use-policy)).
  - **Supabase Cron** (pg_cron) runs SQL jobs and HTTP calls through pg_net, with secrets in Vault ([Supabase Cron](https://supabase.com/docs/guides/cron), [scheduling with pg_net + Vault](https://supabase.com/docs/guides/functions/schedule-functions)).
  - **Supabase is replacing the legacy `anon`/`service_role` keys** with publishable and secret keys, and says the legacy keys will be deprecated by the end of 2026 ([migration guide](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)).

## Decision
- **App and API:** one Next.js 16 (latest 16.x at M0) App Router app in TypeScript strict, styled with Tailwind v4.
  - It is a PWA with a hand-written service worker and an IndexedDB outbox.
  - It is deployed on Vercel with functions pinned to an EU region.
  - Every screen reads `/api/*` route handlers, and the handlers call service modules.
- **Data and auth:** Supabase in an EU region (Postgres with RLS, Auth, Storage, Realtime).
  - The browser uses the publishable key. The secret key is used only by cron services and scripts.
- **Scheduler:** **Supabase Cron is the single scheduler.** SQL jobs run in the database, and jobs that need external APIs call `/api/cron/*` through pg_net with a bearer secret kept in Vault.
- **Other services:** Claude API, Google Drive API, Resend and Sentry as in the PRD.

## Alternatives
- **Next.js 15 as written in the PRD.** Pros: matches the PRD text. Cons: an older major, reported to be at end of life. Why not: it would force an upgrade early in a 12-month roadmap.
- **Vercel Cron for every schedule.** Pros: one vendor. Cons: once a day on Hobby; on Pro, scheduling would be split across Vercel and pg_cron anyway. Why not: pg_cron covers every schedule on any Vercel plan and keeps SQL jobs next to the data.
- **Separate API service (NestJS/Fastify) plus an SPA, or Remix/SvelteKit.** Pros: a clean separation of API and UI. Cons: a second deployable, more ops, and a different framework from the PRD's. Why not: Next.js route handlers already give a JSON API in the same repo.
- **Native apps (Expo/React Native).** Pros: device APIs. Cons: app stores and review delays; the PRD wants no app store. Why not: a PWA is enough. Web Bluetooth for a scale is Phase 3 and Android-only anyway.
- **Firebase/Firestore.** Pros: offline sync built in. Cons: no SQL transactions across ledgers, no SQL row-level policies, and a different data model from the PRD's tables and procedures. Why not: the ledger integrity rules (ADR-002) need Postgres.
- **A self-hosted VPS with Postgres.** Pros: full control. Cons: a server to maintain, which contradicts the PRD's goal of "no server to maintain". Why not: ops burden for one developer.

## Consequences
- Good:
  - One repo and one deployable.
  - Preview deploys per PR.
  - Database logic (procedures, RLS, cron) lives next to the data.
  - The JSON API gives the Phase 3 assistant its interface for free.
  - Schedules do not depend on the Vercel plan.
- Bad / accepted trade-offs:
  - Two vendors (Vercel and Supabase) hold secrets and data, so there are two sub-processors (see the plan's §3.11.8).
  - pg_net calls are fire-and-forget, so cron routes must be idempotent and log to `job_run`.
  - Function duration limits on the chosen Vercel plan constrain synchronous work, so extraction is asynchronous.
  - Production on Vercel needs a commercial plan decision (plan Q9/Q10).
- What would make us revisit this:
  - Supabase or Vercel can no longer host in the EU.
  - Running costs exceed the PRD target at multi-venue scale.
  - A Next.js major release changes route handlers or caching in a way that blocks the API-first rule.
  - The client requires on-premises hosting.
