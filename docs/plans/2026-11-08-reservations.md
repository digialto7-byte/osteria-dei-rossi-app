# Tech plan — Osteria Digitalization · Reservations (Phase 2 add-on)

- **Client slug / internal:** `osteria-dei-rossi`.
  - **Client facts used:** none. `docs/client-facts.md` has the trading name only. The **legal name, VAT number and privacy contact** that the privacy notice needs are **not approved**: DigiAlto-Ops `profile.md` line 17 "Legal name / VAT:" is empty, and line 87 lists them as missing. Step B13 adds them to `docs/client-facts.md` as placeholders marked `[PENDING founder]`. They reach production only as tenant settings that the owner enters (§3.7). The venue phone and opening hours are not approved either, so there is **no default booking time** and no phone number in any text (Q-R5, Q-R17).
  - **Fixtures** follow the M21–M25c conventions:
    - tenants "Osteria Demo A/B";
    - users "Titolare Demo", "Admin Demo", "Chef Demo", "Cameriere Demo";
    - tables "Tavolo 1–5 (demo)";
    - customers "Cliente Demo" and "Cliente Due Demo", e-mails `cliente.demo@example.com` and `cliente.due@example.com`, phones `+39 000 0000001` and `+39 000 0000002`;
    - legal name "Osteria Demo S.r.l. (demo)", VAT `IT00000000000`, privacy contact `privacy@example.com`.
- **Repo and branch:** `osteria-dei-rossi-app`, worktree `/home/user/osteria-resv`, branch `feat/reservations`, from `main`.
  - `main` has M0–M25c and A5 merged. Its latest migration is `20261122100000_cron_vercel_protection_bypass.sql`.
  - M25 go-live, which carries ADR-028, is on `feat/m25-go-live` and **not yet on `main`**.
  - **Not a milestone:** there is no `M<NN>`. The work ships as two PRs:
    - **PR1** `feat/reservations`: data model, settings, staff side;
    - **PR2** `feat/reservations-public`, branched from the merged PR1: public page, e-mails, retention.
- **Numbering:**
  - migrations: PR1 `20261124100000`–`20261124100600`; PR2 `20261125100000`–`20261125100300`; review fixes `…100700`+ of the same day; variants `20261126100000`+;
  - pgTAP: PR1 `290`–`296`; PR2 `297`–`301`; variants `310`+. (`287` is the cron bypass; `288`–`289` are left free.)
  - ADR-032 (`docs/adr/adr-032-public-reservation-requests.md`, proposed). ADR-028 lives on `feat/m25-go-live`. 032 is the next free number on every worktree checked (`osteria-resv`, `osteria-m25`).
  - questions **Q-R1…Q-R17**; variants **V1–V7**; technical items **T-R1…T-R6** (§6);
  - e2e `e2e/reservations-staff.spec.ts` (PR1) and `e2e/reservations-public.spec.ts` (PR2).
- **Shared lists (house lesson).** Eight public tables, one `app` table and a number of functions are added. Every list that spells them out changes on purpose in a named step:

  | List | Change | Step |
  |---|---|---|
  | `app.demo_purge_tables()` (new migration `20261124100100`) | `reservation_email`, `reservation_event`, `reservation_table`, `reservation_contact`, `reservation` go immediately **before** `service_override`. `table_group_member`, `table_group`, `dining_table_booking` go immediately **before** `dining_table`. `reservation_settings` goes after `service_schedule` | A1 |
  | pgTAP public-table lists and purge `not in` exclusions (the ones M25c edited: `207`, `214`, `229`, `222`, `240`) | the eight public names, in sorted position | A1 |
  | pgTAP `229` (md5 of the other public function names) | every new public function added to the `not in` list | A2, A5, A6, B1, B2, B3 |
  | The M0 waiter-readable-columns test (project plan §3.11.2) | the columns of `reservation`, `reservation_contact`, `reservation_table`, `reservation_event` added to its fixture; none matches `cost\|margin\|price\|eur` | A1 |
  | `tests/config/check-constraint-union.test.ts` | audit: entity `reservation_settings` and action `reservation_settings.changed` (A2); `job_run`: `reservation-mail` (B3) and `reservation-retention` (B4) | A2, B3, B4 |
  | `app.job_health_checks` | watches `reservation-retention`, because a GDPR job must not fail silently | B4 |
  | `tests/config/{m25a,m25b,m25,m25c}-preserves.test.ts` (each pins the migrations after its base) and `tests/config/reservations-preserves.test.ts` (A1's own pin) | the `20261124*` names allowed on purpose (A1); the `20261125*` names allowed on purpose (B1) | A1, B1 |
  | Nav (`src/lib/nav/nav-model.ts`, `tests/lib/nav/nav-model.test.ts`, `e2e/app-shell.spec.ts` routes, `tests/guards/back-link.test.ts`) | `/prenotazioni` added in group `sala` for owner, admin and waiter | A13 |
  | Proxy `PUBLIC_PREFIXES` (`src/lib/supabase/proxy.ts`, `tests/lib/supabase/proxy.test.ts`) | `/prenota` added (reachable signed out) | B11 |
  | `withCron` `CronJob` type (`src/server/cron/with-cron.ts`) | `"reservation-mail"` added | B10 |
  | `tests/guards/admin-client-importers.test.ts` | `src/server/cron/reservation-mail-job.ts` added (an allowed path) | B10 |
  | `.env.example`, `src/lib/env/index.ts` | `RESERVATION_GATE_KEY`, `RESERVATION_LINK_KEY`, `RESERVATION_LINK_KEY_PREVIOUS`, `MAIL_TRANSPORT`, `MAIL_FROM`, `MAILPIT_URL`, `APP_PUBLIC_ORIGIN`, with fake values | B6 |
  | **Unchanged on purpose:** `tests/lint/offline-cache-allowlist.test.ts` (no reservation read is cached on a device); `tests/config/no-new-deps.test.ts` (no package); `public.open_table`, `public.tables_list`, `app.table_session_guard`, `close_table`, bills, day close, `app.session_services` (pinned, asserted in `296`) | — | A7 |
- **Author:** architect · **Date:** 2026-11-08
- **Sources:**
  - the founder's decisions of 2026-11-08 (through the lead) and `CLAUDE.md`;
  - `docs/prd.md` lines 21 and 68; project plan §3.6, §3.9, §3.11 and §5a;
  - the M25c plan, ADR-031, ADR-010, ADR-016, ADR-023, and ADR-028 (`/home/user/osteria-m25/docs/adr/adr-028-nonce-csp-in-proxy.md`);
  - the merged code in §2.

  **Where merged code and a plan differ, the code wins.**

> **Flags for the founder (read first)**
> - **SCOPE CHANGE.** You lifted two PRD lines on 2026-11-08, **for this feature only**:
>   - `docs/prd.md` line 21, the non-goals "reservations, … customer data of any kind";
>   - line 68, the out-of-scope items "reservations, … customer data".
>
>   Everything else in those lines stands.
> - **This is the first customer personal data in the app.**
>   - Project plan §3.11.8 says "No customer personal data is stored". Step A15 adds an exception line there.
>   - The GDPR duties in §3.9 apply.
>   - The lead records the change in DigiAlto-Ops `clients/osteria-dei-rossi/context.md`. `docs/prd.md` is the kickoff copy and is not edited.
> - **Customers ask, staff decide.**
>   - A request is never confirmed automatically: you or the admin accept or decline it.
>   - The customer gets an e-mail when the request is received, accepted or declined. Each carries a cancel link.
> - **Customers never see tables.** Tables, seats and groups are for staff only. On accept, the app suggests the smallest table or group that fits, and you can change it.
> - **Combining tables:**
>   - The waiter opens **one** table for the whole party. The bill, covers and Pranzo/Cena work exactly as today.
>   - The other tables of the group show as "unito a Tavolo 1" in Prenotazioni, but they are not locked in Sala (Q-R6 → V4).
> - **Nothing goes public until you switch it on.** Switching on needs:
>   - the page address;
>   - the legal name and privacy contact for the notice;
>   - the booking hours for each service. We will not guess your hours (Q-R5).
> - **Before real customers:**
>   - a custom domain for the app (staging is behind Vercel's login);
>   - a Resend account with a verified sending domain.
>
>   Both are yours to decide (Q-R14, Q-R15). The code can merge before that; until then the page is reachable only on staging and preview.
> - **New secrets, but no new package and no paid service added by the code.** Resend is a new sub-processor. Its prices and how long it keeps e-mails are open questions (Q-R14), not estimated here.
> - **Q-R1–Q-R17 have defaults in force for this build.** They go in both PR bodies.

## 1. Goal and scope

- **Goal:** a customer can ask for a table from a phone in under a minute. Staff can accept, place and seat that booking without leaving the Sala workflow. The customer's data is kept only as long as needed.
- **In scope**
  - **Data (PR1):** `reservation_settings`, `dining_table_booking` (bookable flag and seats), `table_group` + `table_group_member`, `reservation`, `reservation_contact` (the personal data, in its own table), `reservation_table`, `reservation_event` (append-only), `reservation_email` (outbox), `app.reservation_throttle`.
  - **Staff side (PR1):**
    - settings cards on `/tavoli/impostazioni`;
    - the `/prenotazioni` day/service view in Sala;
    - owner/admin: accept, decline, move, assign tables, erase customer data;
    - owner/admin/waiter: arrived, no-show, open the table(s).
  - **Public side (PR2):**
    - `/prenota/[slug]` (it/en, no login) and `/prenota/[slug]/annulla?t=…`;
    - `/api/public/reservations/*` with abuse protection;
    - a mail abstraction (Resend, plus a Mailpit sink for dev and test);
    - `/api/cron/reservation-mail`;
    - the retention job.
- **Out of scope** (each a variant or a later plan)
  - waiters accepting or declining (Q-R1 → V1);
  - chef access (Q-R2 → V2);
  - CAPTCHA (Q-R7 → V3);
  - combined tables locked in Sala (Q-R6 → V4);
  - host-based tenant mapping (Q-R3 → V5);
  - an e-mail when staff move a booking (Q-R9 → V6);
  - free-text notes or allergies (Q-R13: health data, a re-plan);
  - phone bookings typed by staff (Q-R16);
  - alerts to staff on new requests (Q-R10);
  - deposits, payments, reminders, a waiting list, marketing consent, SMS or WhatsApp;
  - any change to `table_session`, `open_table`, `tables_list`, orders, bills, day close, services, KPIs or the offline queue.

## 2. Current state (`main`, latest migration `20261122100000`)

### 2.1 Reused as they are

| Object (file) | State | Reservations use it how |
|---|---|---|
| `public.dining_table` (`20261031100000`) | name, position, `is_active`; unique `(tenant_id, id)`; guard; RLS owner/admin | FK target of `dining_table_booking`, `table_group_member` and `reservation_table`. **No column is added**, so its writers `create_dining_table`/`update_dining_table` stay untouched |
| `public.table_session` + `public.open_table(p_table, p_session, p_covers)` (`20261031100500`) | **one `dining_table_id` per session**; partial unique index "one open session per table"; client-generated id, so a replay is safe; `require_table_operator` (owner/admin/waiter) | Seating calls `open_table` unchanged, then links the session (§3.3) |
| `app.service_periods_at`, `app.service_windows`, `app.service_key_for`, `app.business_day_cutoff`, `app.business_date` (M25c, M11) | services are versioned tenant data; windows by start time; local wall time | The service of a requested time and the business date of a booking |
| `app.require_day_closer()` (owner/admin), `app.require_table_operator()` (owner/admin/waiter) | role gates | Role checks of every staff function |
| `app.append_only`, `app.append_only_truncate`, `app.demo_purge_allows` | ledger guards | On `reservation_event`, plus the delete and truncate guards elsewhere |
| `app.call_cron_route(p_path)` (`20261022120200`; bypass header `20261122100000`) + Vault `app_base_url`, `cron_secret` | pg_cron → pg_net → `/api/cron/*` with the bearer | The mail job, exactly like `extract-invoices` |
| `withCron` (`src/server/cron/with-cron.ts`) | POST only, constant-time bearer check, secret-key client, `job_run` | The mail route |
| `withApi` (`src/lib/api/with-api.ts`) | `{public: true}` / `{roles}` access, strict Zod, JSON errors | Every new route |
| `hashIp` (`src/server/staff-auth/tokens.ts`), `app.enrol_failure` (`20261025100000`) | an HMAC of the first `x-forwarded-for`; a per-IP counter in the `app` schema | Precedent for the throttle (hashed in SQL here, §3.2) |
| `e2e/helpers/mailbox.ts`, CI `E2E_MAILPIT_URL` | reads Mailpit `GET /api/v1/messages` and `/message/:id` | Reads the reservation e-mails in tests |
| `src/app/(public)/layout.tsx` | signed-out layout, no shell | Parent of `/prenota/*` |
| `src/lib/i18n` (`it`, `en`) | typed catalogues | All texts, e-mails included |

### 2.2 Missing (checked)

- **No mail abstraction.** `grep -ri "resend|sendMail|mailer" src/` finds nothing; auth mail goes through Supabase Auth. `RESEND_API_KEY=replace-me` in `.env.example` is read by no code (M6 §6).
- **No throttle for public endpoints.** The only limits are Supabase Auth's (429, mapped in the routes) and the enrolment counter `app.enrol_failure`.
- **No nonce CSP on `main`.** `src/lib/security-headers.ts` sends only `frame-ancestors 'none'` (M0). ADR-028 (accepted) arrives with M25. The public page is built to its policy (§3.8).
- **No customer data anywhere**, no public write path and no anon-granted function.

## 3. Design

### 3.1 Decisions

1. **Request, then approval (founder).**
   - Allowed changes:
     - `pending` → `accepted` | `declined` | `cancelled`;
     - `accepted` → `arrived` | `seated` | `no_show` | `declined` | `cancelled`;
     - `arrived` → `seated` | `no_show`.
   - A `pending` request whose start has passed reads as `expired`. Every read derives it; the nightly job stores it (B4).
   - `declined` after `accepted` is staff saying "we cannot host you after all". It sends the declined e-mail (Q-R9), but only before the booking's start: after it (an expired request) staff can still decline to clean up, and no e-mail is queued.
2. **The personal data is a separate table.**
   - `reservation_contact` (name, phone, e-mail, locale) is 1:1 with `reservation`.
   - Retention and erasure **delete the contact row**. The anonymous `reservation` (date, time, party, status, tables) stays for statistics (Q-R11).
   - `reservation_contact` is not a ledger. Its only delete paths are `app.purge_reservation_contacts` (B4) and `public.erase_reservation_contact` (A5); DELETE is revoked from every API role.
3. **State on the row, history in a ledger.** `reservation.status` and the slot are updated only by definer procedures, under a guard trigger. Every change also appends one `reservation_event` row (append-only). This is the same split as `table_session` plus audit.
4. **Times.** The customer picks a date, a service, a time (`HH:MM` on the slot grid) and the party size.
   - `starts_at = (date + time) at time zone tenant.timezone`. A local time that does not exist (the spring DST gap) is refused by a round-trip check.
   - `service_key` must equal `app.service_key_for(<version in force now>, time, cutoff)`.
   - `business_date = app.business_date(tenant, starts_at)`.
   - `ends_at = starts_at + stay_minutes`, stored and recomputed on a move.
5. **Capacity is soft; staff approve anyway.** A request is refused when:
   - the date is closed (a closed weekday or a closed date);
   - the time is outside the service's booking window or off the grid;
   - it is earlier than `now + lead_minutes` or later than `today + horizon_days`;
   - `party > max_party_online` (the page then shows "chiamaci");
   - a per-slot or per-service limit would be exceeded, counting `pending` + `accepted` + `arrived` + `seated`;
   - at least one bookable table has seats, and no bookable table or active group has `seats ≥ party`.

   Table occupancy is **not** checked at request time; it is checked at accept (decision 7).
6. **Tables are staff-only.**
   - `dining_table_booking` holds `bookable` and `seats` per table.
   - A `table_group` is a named set of ≥ 2 active tables with its own `seats` (T1+T2 = 8, not the sum).
   - Members are immutable: editing a group means deactivating it and creating a new one.
7. **Suggestion and assignment.**
   - On accept the app proposes the **smallest fit**:
     - first, among bookable single tables with `seats ≥ party` that are free during `[starts_at, ends_at)` (no overlapping `accepted|arrived|seated` reservation holds them): the fewest seats, then `position`, then name;
     - if none, the active group with the fewest seats whose members are all free;
     - otherwise no suggestion.
   - Staff may accept with the suggestion, another table or group, or no table.
   - Assigning a table already held by an overlapping reservation → 409 `table_taken`.
   - A move releases the assignment (the rows get `released_at`), and the reply carries a fresh suggestion.
8. **Combining tables at service (the M17–M21 mapping).**
   - A reservation seated on several tables becomes **exactly one `table_session` on its lead table**: the assigned table with the lowest `position`, then name.
   - The session is opened by the unchanged `open_table`, with `covers = party` (editable).
   - Bills, covers, the coperto, the M25c service split (from that session's `opened_at`) and the day close are those of an ordinary session.
   - The other tables of the assignment get **no session**. `/prenotazioni` shows them as "unito a <lead>" for the reservation's window.
   - `tables_list` and `open_table` are unchanged, so Sala does not lock those tables. A waiter could still open one separately. That gives a second ordinary bill and breaks no invariant. Locking them is V4, which needs `open_table` and `tables_list` replaced and re-pinned.
   - **Rejected: one session over several `dining_table` rows.** It turns `table_session.dining_table_id` into a set and touches:
     - the partial unique index, `open_table`, `close_table`, `tables_list` and `app.table_session_guard`;
     - the offline `apply_op`, the kitchen tickets (`table_name` snapshot) and the bill;
     - the pins `214`, `222`, `229`, `240`, `286`.

     That is not worth it for a nice-to-have.
9. **Public path (ADR-032).**
   - The public functions are `SECURITY DEFINER` functions in `public`, granted to anon. Each requires a **route gate**: an HMAC over the function name, the slug and a timestamp (±60 s).
   - The gate key is `RESERVATION_GATE_KEY` in the Vercel env, with the same value in Vault `reservation_gate_key`.
   - So a direct PostgREST call with the public key fails. The honeypot, fill time, Origin check and IP limits cannot be skipped.
   - No public route uses the Supabase secret key (rule 2 unchanged).
10. **Tenant resolution:** `/prenota/<slug>`. `reservation_settings.public_slug` is globally unique and set by the owner or admin. An unknown, disabled or not-ready slug gives the same 404. Host mapping is V5.
11. **E-mails go through an outbox.**
    - The state change and its `reservation_email` row are written in one transaction.
    - pg_cron calls `/api/cron/reservation-mail` every minute, only when work is due.
    - The route (where the secret key is allowed):
      1. claims rows with a lease;
      2. renders the it/en text and HTML;
      3. sends through `MailSender`, with the row id as the idempotency key;
      4. records the result.
    - Sending inline from user routes was rejected (§4).
12. **Abuse protection:**
    - a honeypot field `website`;
    - a signed form token with a minimum fill time (3 s) and a maximum age (2 h);
    - `Origin` must be the app's own origin;
    - body ≤ 4 KB;
    - DB limits per day on a **daily-salted HMAC** of the IP, the e-mail and the phone (`app.reservation_throttle`; raw values are never stored);
    - a per-tenant cap on open `pending` requests.

    No CAPTCHA by default (V3).
13. **Cancel link:** `/prenota/<slug>/annulla?t=<token>`.
    - Token `c1.<kid>.<reservationId>.<exp>.<mac>`, where `mac = HMAC-SHA256(RESERVATION_LINK_KEY, "resv-cancel|c1|<reservationId>|<exp>")` and `exp = starts_at − cancel_until_minutes` (default 0).
    - The GET page only shows the booking and a button; only the POST cancels, because mail scanners prefetch GETs.
    - **Single use:** the status changes once. Any later use answers "già annullata".
    - **No enumeration:** a bad MAC, a wrong kid, an unknown id, another tenant's slug or an expired link all give the same 404 `link_invalid`. The MAC is checked before any database call.
14. **Roles (enforced in Postgres):**
    - owner and admin: everything;
    - waiter: reads the day view with the customer's data, marks arrived/no-show, seats;
    - chef: nothing (42501, 0 rows).

    No money anywhere: no column, key or text names `eur|cost|price|margin|total`.
15. **No data logic in React.** SQL computes availability, slots, the effective status, `actions` (what the caller may do), the suggestion and "unito a". Components format only.
16. **Implicit defaults, each tested with ≥ 2 candidates:**
    - slot edges (first and last booking time, off-grid);
    - lead time −1 min / +0;
    - horizon day / day + 1;
    - closed weekday vs open; closed date vs not;
    - CET, CEST and the spring gap;
    - party = max / max + 1;
    - per-slot limit n − 1 / n;
    - table fit with and without seats configured;
    - free vs overlapping table (an end equal to a start touches, it does not overlap);
    - cancel `exp` −1 s / +0;
    - retention day N / N + 1;
    - IP, e-mail and phone counts n − 1 / n;
    - owner, admin, waiter, chef;
    - two tenants.

### 3.2 Data model (PR1 unless marked)

**Common rules** (as M25c §3.2):
- every function is `security definer` with `set search_path = ''`;
- every `app.*` function is revoked from `public, anon, authenticated, service_role`;
- staff public functions are thin wrappers (role check first) over `app.*_at` twins that take `p_now`;
- DETAILs carry codes only, so no personal data reaches the Postgres log.

**`20261124100000_reservation_core.sql`** (A1)

```sql
create type public.reservation_status as enum
  ('pending','accepted','declined','cancelled','expired','arrived','seated','no_show');

create table public.reservation_settings (
  tenant_id uuid primary key references public.tenant (id),
  enabled boolean not null default false,
  public_slug text unique check (public_slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  venue_phone text check (venue_phone ~ '^\+?[0-9 ]{6,20}$'),              -- typed by the owner (Q-R17)
  slot_minutes smallint not null default 15 check (slot_minutes in (15, 30, 60)),
  stay_minutes smallint not null default 120 check (stay_minutes between 30 and 360),
  lead_minutes smallint not null default 120 check (lead_minutes between 0 and 2880),
  horizon_days smallint not null default 60 check (horizon_days between 1 and 365),
  max_party_online smallint not null default 8 check (max_party_online between 1 and 40),
  cancel_until_minutes smallint not null default 0 check (cancel_until_minutes between 0 and 2880),
  retention_days smallint not null default 30 check (retention_days between 1 and 365),
  closed_weekdays smallint[] not null default '{}' check (closed_weekdays <@ '{1,2,3,4,5,6,7}'),
  closed_dates date[] not null default '{}' check (cardinality(closed_dates) <= 366),
  services jsonb not null default '{}' check (app.reservation_services_ok(services)),
    -- { "<service key>": { "online": bool, "firstSeating": "HH:MM", "lastSeating": "HH:MM",
    --   "coversPerSlot": int|null, "reservationsPerSlot": int|null, "coversPerService": int|null } }
  privacy_controller_name text check (char_length(privacy_controller_name) between 2 and 200),
  privacy_contact_email text check (char_length(privacy_contact_email) <= 254),
  created_at, created_by, updated_at, updated_by   -- house columns, FKs to app_user
);
create table public.dining_table_booking (
  tenant_id uuid not null, dining_table_id uuid not null,
  bookable boolean not null default false,
  seats smallint check (seats between 1 and 40),
  updated_at, updated_by,
  primary key (tenant_id, dining_table_id),
  foreign key (tenant_id, dining_table_id) references public.dining_table (tenant_id, id)
);
create table public.table_group (
  tenant_id uuid not null, id uuid not null default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  seats smallint not null check (seats between 2 and 99),
  is_active boolean not null default true,
  created_at, created_by, deactivated_at, deactivated_by,
  primary key (tenant_id, id)
);
create unique index table_group_name_uq on public.table_group (tenant_id, lower(btrim(name))) where is_active;
create table public.table_group_member (           -- append-only: members never change
  tenant_id uuid not null, table_group_id uuid not null, dining_table_id uuid not null,
  primary key (tenant_id, table_group_id, dining_table_id),
  foreign key (tenant_id, table_group_id) references public.table_group (tenant_id, id),
  foreign key (tenant_id, dining_table_id) references public.dining_table (tenant_id, id)
);
create table public.reservation (
  tenant_id uuid not null, id uuid not null default gen_random_uuid(),
  status public.reservation_status not null default 'pending',
  business_date date not null, service_key text not null check (service_key ~ '^[a-z][a-z0-9_]{1,31}$'),
  starts_at timestamptz not null, ends_at timestamptz not null check (ends_at > starts_at),
  party smallint not null check (party between 1 and 99),
  source text not null default 'online' check (source in ('online', 'staff')),  -- 'staff' unused until Q-R16 (lead 2026-11-08)
  table_session_id uuid,                                  -- set by seat_reservation
  privacy_notice_version text check (char_length(privacy_notice_version) between 1 and 40),
  privacy_ack_at timestamptz,
  check (source <> 'online' or (privacy_notice_version is not null and privacy_ack_at is not null)),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, id),
  foreign key (tenant_id, table_session_id) references public.table_session (tenant_id, id)
);
create index reservation_day_idx on public.reservation (tenant_id, business_date, service_key, starts_at);
create table public.reservation_contact (           -- personal data; deleted by retention / erasure
  tenant_id uuid not null, reservation_id uuid not null,
  name text not null check (char_length(name) between 1 and 80),
  phone text not null check (phone ~ '^\+?[0-9]{6,15}$'),          -- normalised digits
  email text check (char_length(email) between 3 and 254),        -- required for source 'online' (checked in request_reservation); optional for 'staff'
  locale text not null check (locale in ('it','en')),
  primary key (tenant_id, reservation_id),
  foreign key (tenant_id, reservation_id) references public.reservation (tenant_id, id)
);
create table public.reservation_table (
  tenant_id uuid not null, id uuid not null default gen_random_uuid(),
  reservation_id uuid not null, dining_table_id uuid not null, table_group_id uuid,
  assigned_at timestamptz not null, assigned_by uuid not null,
  released_at timestamptz, released_by uuid,                  -- released, never deleted
  primary key (tenant_id, id)                                 -- + composite FKs to reservation, dining_table, table_group, app_user
);
create unique index reservation_table_current_uq on public.reservation_table (tenant_id, reservation_id, dining_table_id)
  where released_at is null;
create table public.reservation_event (              -- append-only ledger
  tenant_id uuid not null, id uuid not null default gen_random_uuid(), seq bigint generated always as identity,
  reservation_id uuid not null,
  kind text not null check (kind in ('requested','accepted','declined','moved','tables_assigned','arrived',
                                     'seated','no_show','cancelled_by_customer','expired','contact_erased','contact_purged')),
  data jsonb not null default '{}',                   -- codes, times, party, table ids; never personal data
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid,                                    -- null = the customer or a job
  primary key (tenant_id, id)
);
create table public.reservation_email (               -- outbox; no address, no personal data
  tenant_id uuid not null, id uuid not null default gen_random_uuid(),
  reservation_id uuid not null, kind text not null check (kind in ('received','accepted','declined')),
  status text not null default 'queued' check (status in ('queued','sending','sent','failed','skipped')),
  attempts smallint not null default 0, next_attempt_at timestamptz not null default clock_timestamp(),
  lease_until timestamptz, sent_at timestamptz, provider_message_id text, error_code text,
  created_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, id)
);
create table app.reservation_throttle (               -- app schema, like app.enrol_failure
  tenant_id uuid not null, day date not null,
  kind text not null check (kind in ('ip','email','phone')),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  hits integer not null default 0,
  primary key (tenant_id, day, kind, key_hash)
);
```

- **Guards:**
  - `app.reservation_guard` (before update) keeps `id`, `tenant_id`, `created_at`, `privacy_*` and `source` immutable. `status` changes only along §3.1.1. `table_session_id` is set once.
  - `reservation_event` and `table_group_member`: `app.append_only` plus the truncate guard.
  - Every other table refuses delete (`app.append_only` on delete) and truncate, with two exceptions:
    - `reservation_contact`: delete only inside its two definers. A trigger allows it when `current_setting('app.contact_delete', true) = 'on'`, which only those functions set locally;
    - `app.reservation_throttle`: delete only by the retention function.
- **RLS and grants:**
  - RLS on all eight public tables;
  - `revoke all … from anon, authenticated, service_role`, then `grant select … to authenticated, service_role`;
  - **no write grant and no write policy**.
  - `reservation`, `reservation_contact`, `reservation_table`, `reservation_event`: select policy `tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner','admin','waiter')`.
  - `reservation_settings`, `dining_table_booking`, `table_group`, `table_group_member`, `reservation_email`: owner and admin only.
  - The chef gets 0 rows everywhere. `anon` has no table privilege at all.
  - `app.reservation_throttle`: RLS on, no grant to any API role.

**`20261124100100_demo_purge_tables_resv.sql`** (A1): `app.demo_purge_tables()` = the M25c list with the new names placed as in the shared-list table. `app.tenant_has_operational_data` is not replaced: saved settings count as data, like the coperto.

**`20261124100200_reservation_settings.sql`** (A2)
- `app.reservation_services_ok(jsonb)` (immutable) is true when:
  - the value is an object whose keys match the service-key regex;
  - each value has exactly the six keys;
  - `firstSeating ≤ lastSeating`, both as `HH:MM`;
  - each limit is null or 1–999.
- `app.reservation_settings_json(p_tenant, p_now)` returns `{enabled, ready, notReady: [reason], publicSlug, venuePhone, slotMinutes, stayMinutes, leadMinutes, horizonDays, maxPartyOnline, cancelUntilMinutes, retentionDays, closedWeekdays, closedDates, services: [{key, name, startsAt, endsAt, online, firstSeating, lastSeating, coversPerSlot, reservationsPerSlot, coversPerService}], privacy: {controllerName, controllerVat (= tenant.vat_number), contactEmail}}`.
  - A missing row gives the defaults.
  - Services are listed from the version in force (`app.service_periods_at`); unknown keys in `services` are ignored on read.
  - `ready` = the slug is set, `privacy_controller_name` and `privacy_contact_email` are set, and at least one service is `online` with both booking times. The `notReady` reasons are `slug`, `privacy_name`, `privacy_email` and `seating`.
- `app.set_reservation_settings_at(p_tenant, p_user, p_body, p_now)`, in order:
  1. strict keys (22023);
  2. per-field checks → P0001 `reservation_settings_invalid` with DETAIL `{"reason": "<field>"}`;
  3. `enabled: true` while not ready → P0001 `reservations_not_ready` with DETAIL `{"reasons":[…]}`;
  4. a slug taken by another tenant → P0001 `slug_taken`;
  5. upsert, and an `audit_event` `reservation_settings.changed` with field names only;
  6. reply `{changed, …settings}`.
- `app.set_table_booking_at(p_tenant, p_user, p_body)`: body `{tables:[{tableId, bookable, seats|null}]}` (≤ 200 entries). Each must be an active table of the tenant, else P0002 `table_not_found`.
- `app.create_table_group_at(…, {name, seats, tableIds})` takes 2–8 distinct active tables. `group_invalid` reasons: `name`, `seats`, `tables`, `name_taken`. Plus `app.deactivate_table_group_at(…, p_group)`.
- Public functions (owner/admin; `app.require_day_closer()` first): `reservation_settings()`, `set_reservation_settings(jsonb)`, `table_booking()` (tables with `bookable` and `seats`, plus the active groups with their members), `set_table_booking(jsonb)`, `create_table_group(jsonb)`, `deactivate_table_group(uuid)`.

**`20261124100300_reservation_request_core.sql`** (A3; the public wrappers come in B1)
- `app.reservation_slots_json(p_tenant, p_date, p_party, p_now)` returns `{date, closed, services: [{key, name, slots: [{time, available}]}]}`.
  - The grid runs `firstSeating … lastSeating` in steps of `slot_minutes`, for each online service.
  - `available` is false when any decision-5 rule fails.
  - **No count is returned.**
- `app.request_reservation_at(p_tenant, p_body jsonb, p_ip text, p_now)`, in order:
  1. body keys exactly `date, serviceKey, time, party, name, phone, email, locale, privacyNoticeVersion` (else 22023), then field checks;
  2. `pg_advisory_xact_lock(hashtextextended('resv:' || p_tenant || ':' || date || ':' || serviceKey, 0))`;
  3. the decision-5 rules → P0001 `slot_unavailable` with DETAIL `{"reason": "closed"|"seating"|"grid"|"lead"|"horizon"|"party"|"slot_limit"|"service_limit"|"no_fit"|"service"|"dst_gap"}`;
  4. the throttle (below);
  5. insert `reservation`, `reservation_contact`, event `requested` and a `received` `reservation_email` row;
  6. reply `{status: "received"}` (no id).
- **Throttle**, inside the same transaction:
  - `app.reservation_hash(kind, day, value)` = the hex of `extensions.hmac(kind || '|' || day || '|' || value, <Vault reservation_hash_salt>, 'sha256')`. This migration runs `create extension if not exists pgcrypto with schema extensions` (T-R3).
  - It upserts `hits + 1` for the IP, the e-mail (lower-case, trimmed) and the phone (digits).
  - Over `app.reservation_limits()` = `{ip: 5, email: 3, phone: 3, pendingPerTenant: 100}` (Q-R7) → P0001 `rate_limited` (no detail).
  - The IP is only a function argument. It is never stored or logged.
- A **missing Vault secret** → P0001 `reservations_unconfigured`; the route answers 503.

**`20261124100400_reservation_suggest.sql`** (A4)
- `app.reservation_free_tables(p_tenant, p_from, p_to, p_except uuid)`.
- `app.reservation_suggest(p_tenant, p_reservation)` returns `{suggested: {kind: "table"|"group", tableIds, groupId, seats} | null, alternatives: [...]}`: at most 5 alternatives, in the same order, per decision 7.
- Overlap is `tstzrange(starts_at, ends_at, '[)') && …`, so back-to-back bookings do not overlap.

**`20261124100500_reservation_staff.sql`** (A5)
- Owner/admin (`require_day_closer`) unless marked otherwise.
- Each function locks the reservation `FOR UPDATE`. Assignments then also take `pg_advisory_xact_lock(hashtextextended('resv-tables:' || tenant || ':' || business_date, 0))`.

| Function | Body | From → to | Side effects | Errors |
|---|---|---|---|---|
| `accept_reservation(p_id, p_body)` | `{tableIds: uuid[] \| null, groupId: uuid \| null}`; `null` + `null` = no table | pending → accepted | `reservation_table` rows, an event, an `accepted` e-mail (if the contact exists) | `reservation_expired` (now ≥ starts_at), `status_invalid`, `table_taken`, `table_not_found`, `group_mismatch` |
| `decline_reservation(p_id, p_body)` | `{reason: "full"\|"closed"\|"other"}` | pending/accepted → declined | releases the tables, an event, a `declined` e-mail | `status_invalid` |
| `move_reservation(p_id, p_body)` | `{date, time, serviceKey, party}` | pending/accepted (status kept) | recomputes the slot and `ends_at`, releases the tables, event `moved` | the `slot_unavailable` reasons except `lead` and `party` (staff may move inside the lead time and above the online maximum) |
| `assign_reservation_tables(p_id, p_body)` | as accept | accepted/arrived | release + insert, an event | as accept |
| `mark_reservation(p_id, p_body)`, **owner/admin/waiter** (`require_table_operator`) | `{mark: "arrived"\|"no_show"}` | accepted → arrived (on its business date); accepted/arrived → no_show (once now ≥ starts_at) | an event | `status_invalid`, `too_early` |
| `seat_reservation(p_id, p_session)`, **owner/admin/waiter** | the session must be open, of the same tenant, and on a table of the current assignment (any table if none is assigned) | accepted/arrived → seated (on its business date) | sets `table_session_id`, an event | `session_not_found`, `session_closed`, `table_not_assigned`, `status_invalid`, `too_early`, `not_today` |
| `erase_reservation_contact(p_id)` | none | any status | deletes the contact, event `contact_erased`; queued e-mails become `skipped` | — |

All of them return the detail shape of A6. A request equal to the current state writes nothing (`changed: false`).

**`20261124100600_reservation_reads.sql`** (A6)
- `public.reservations_day(p_date date)`, owner/admin/waiter, returns `{businessDate, services: [{key, name, startsAt, endsAt, totals: {reservations, covers, pending}, reservations: [Row]}]}`.
  - `Row = {id, time, startsAt, party, status (effective), name, phone, email, tables: [{id, name}], joinedTo: {id, name} | null, groupName, sessionId, emailStatus, actions: [...]}`.
  - `emailStatus` is present for owner/admin only; the key is absent for the waiter.
  - Rows whose contact was erased or purged show `name`, `phone`, `email` as null.
- `public.reservation_detail(p_id)`: the Row, plus `events: [{kind, at}]` (no staff names). For owner/admin on pending or accepted bookings it also carries `suggestion`.
- `public.reservations_pending_count()`, owner/admin, returns `{pending}` for the Prenotazioni badge.
- The chef gets 42501 on all three.

**PR2 migrations** (B1–B4) are described with their steps in §5. Their objects:
- `app.reservation_gate_ok`;
- the anon wrappers `public.reservation_page`, `public.reservation_slots`, `public.request_reservation`, `public.reservation_cancel_view`, `public.cancel_reservation`;
- `public.reservation_mail_claim` and `public.reservation_mail_finish` (service_role only);
- `app.reservation_mail_due()` and the cron job `reservation-mail`;
- `app.run_reservation_retention()` and the cron job `reservation-retention`.

### 3.3 Sequence of calls and locks

1. **A customer requests (PR2).**
   - `/prenota/<slug>` → `GET /api/public/reservations/<slug>/page` (config plus a signed form token).
   - Once a date and party are picked → `GET …/<slug>/slots?date=&party=`.
   - Submit → `POST …/<slug>/requests`. The route checks, in order:
     1. JSON, `Origin` and size;
     2. Zod;
     3. the honeypot (filled → 202 and nothing is written);
     4. the form token (MAC, age ≥ 3 s and ≤ 2 h);
     5. then calls the anon client `rpc("request_reservation", {p_slug, p_gate_ts, p_gate_mac, p_body, p_ip})` → 202 `{status: "received"}`.
   - In SQL, in one transaction: gate → slug → advisory lock → rules → throttle → inserts.
2. **Mail (PR2).**
   - pg_cron `* * * * *` runs `select app.call_cron_route('/api/cron/reservation-mail') where app.reservation_mail_due()`.
   - The route (`withCron`) calls `reservation_mail_claim(10)`. It takes due `queued`/`failed` rows `FOR UPDATE SKIP LOCKED` with a 120 s lease, and returns each row with the contact, the reservation and the settings needed for the text.
   - It renders, sends through `MailSender.send`, then calls `reservation_mail_finish(id, ok, providerId, errorCode)`.
   - Backoff: 1, 5, 15, 60 min. After 5 attempts the row is `failed` for good. A missing contact → `skipped`.
3. **Staff accept (PR1).** `/prenotazioni?data=D` → `GET /api/reservations?date=D` → tap a row → sheet → `GET /api/reservations/:id` (with the suggestion) → "Accetta" → `POST /api/reservations/:id/accept {tableIds, groupId}` → re-read.
4. **Seating (PR1).**
   - The waiter taps "Apri tavolo" → `POST /api/reservations/:id/seat {sessionId (client uuid), covers}`.
   - The server calls `rpc("open_table", {p_table: <lead>, p_session, p_covers})` (unchanged and replay-safe), then `rpc("seat_reservation", {p_id, p_session})`.
   - The reply carries the session id, and the client navigates to the comanda.
   - These are two transactions; a retry replays both safely.
5. **Cancel (PR2).**
   - The e-mail link opens `/prenota/<slug>/annulla?t=`, which reads `GET /api/public/reservations/<slug>/cancel?t=`. The route checks the MAC, then calls `reservation_cancel_view`.
   - "Annulla prenotazione" → `POST …/cancel {token}` → `cancel_reservation`: gate; `FOR UPDATE`; if the status is pending/accepted and now < exp → `cancelled`; the tables are released; event `cancelled_by_customer`.
6. **Retention (PR2).** pg_cron `20 3 * * *` (UTC) runs `app.run_reservation_retention()`:
   - pending requests past their start → `expired` (with an event);
   - contacts with `business_date < today_local − retention_days` are deleted (event `contact_purged`);
   - throttle rows with `day < today − 2` are deleted;
   - queued e-mails of purged contacts → `skipped`;
   - a `job_run` row is written.

**Locks:**
- A request takes one advisory lock per (tenant, date, service).
- A staff action locks the reservation `FOR UPDATE`, then the per-(tenant, date) table advisory lock.
- Seating: `open_table` takes its own `dining_table FOR UPDATE` in its own transaction; `seat_reservation` then takes the reservation `FOR UPDATE` and `table_session FOR SHARE`.
- Mail uses `SKIP LOCKED` on outbox rows.
- No two locks are taken in opposite orders; the race cases of A3 and A5 prove it.

### 3.4 API

House rules (Zod 4, `withApi`): a strict query or body, else 400; JSON only, else 415; a malformed id → 404 before any RPC; errors as `{"error":{"code","message","details?"}}`; `Cache-Control: no-store`.

**Staff (PR1).** Files: `src/server/reservations/{constants,schemas,output,errors,settings,tables,day,actions,seat}.ts`.

| Endpoint | Roles | Input | Success | Errors |
|---|---|---|---|---|
| `GET`/`PATCH /api/settings/reservations` | owner, admin | settings body (≤ 4 KB) | 200 settings (+ `changed`) | 403 chef/waiter before any RPC; 409 `slug_taken`; 422 `reservation_settings_invalid` (`details.reason`), `reservations_not_ready` (`details.reasons`) |
| `GET`/`PUT /api/settings/reservations/tables` | owner, admin | `{tables:[{tableId, bookable, seats}]}` | 200 | 404 `table_not_found`; 422 |
| `POST /api/table-groups`, `POST /api/table-groups/:id/deactivate` | owner, admin | `{name, seats, tableIds}` | 201 / 200 | 422 `group_invalid` |
| `GET /api/reservations?date=` | owner, admin, waiter | `z.iso.date()`, from 62 days back to the horizon ahead | 200 day | 403 chef; 422 `date_invalid` |
| `GET /api/reservations/pending-count` | owner, admin | none | 200 `{pending}` | 403 |
| `GET /api/reservations/:id` | owner, admin, waiter | — | 200 detail | 404 |
| `POST /api/reservations/:id/{accept,decline,move,tables}` | owner, admin | as §3.2 | 200 detail | 404; 409 `status_invalid`, `table_taken`, `reservation_expired`; 422 |
| `POST /api/reservations/:id/mark` | owner, admin, waiter | `{mark}` | 200 | 409 `status_invalid`, `too_early` |
| `POST /api/reservations/:id/seat` | owner, admin, waiter | `{sessionId: z.uuid(), covers: 1–99}` | 200 `{sessionId, created}` | 409 `table_already_open` (from `open_table`, unchanged), `table_not_assigned`, `status_invalid`; 422 `covers_invalid` |
| `POST /api/reservations/:id/erase-contact` | owner, admin | `{}` | 200 | 404 |

**Public (PR2).**
- Files: `src/server/reservations/public/{tokens,gate,schemas,output,page,slots,request,cancel}.ts` and `src/lib/supabase/anon.ts`. The anon client uses the publishable key and no cookies, so the role is always `anon`, even on a staff phone.
- Access is `{public: true}`. Every POST checks `Origin`. The cancel routes set `X-Robots-Tag: noindex`.

| Endpoint | Input | Success | Errors |
|---|---|---|---|
| `GET /api/public/reservations/:slug/page` | slug regex | 200 `{venueName, services:[{key,name}], minDate, maxDate, closedWeekdays, closedDates, maxPartyOnline, venuePhone, privacy:{controllerName, controllerVat, contactEmail, noticeVersion}, formToken}` | 404 `not_found` (the same answer for unknown, disabled and not ready); 503 `reservations_unconfigured` |
| `GET /api/public/reservations/:slug/slots?date=&party=` | date; party 1–`maxPartyOnline` | 200 slots (no counts) | 400; 404; 422 `date_invalid` |
| `POST /api/public/reservations/:slug/requests` | `{date, serviceKey, time, party, name, phone, email, locale, privacyAck: z.literal(true), website: z.string().max(200), formToken}` (≤ 4 KB) | **202** `{status:"received"}`, also for a filled honeypot | 403 `origin_invalid`; 404; 413; 415; 422 `form_too_fast`, `form_expired`, `slot_unavailable` (`details.reason`), field errors; 429 `rate_limited`; 503 |
| `GET /api/public/reservations/:slug/cancel?t=` | token | 200 `{date, time, party, serviceName, status, canCancel}` (no name, phone or e-mail) | 404 `link_invalid` |
| `POST /api/public/reservations/:slug/cancel` | `{token}` | 200 `{status:"cancelled", already: bool}` | 403; 404 `link_invalid`; 409 `cancel_closed` (past `exp`) |

### 3.5 Screens (Italian first, English second; 360 px first; targets ≥ 44 px; every value from `/api/*`)

- **`/tavoli/impostazioni`** (owner/admin): three cards under "Servizi".
  - "Prenotazioni online":
    - the switch, with the `notReady` reasons as a checklist;
    - the slug, with a preview of the full address;
    - the numeric settings, closed weekdays and closed dates;
    - per service: online, booking times, limits;
    - the privacy name and contact, and the venue phone.
  - "Tavoli prenotabili": per table, a switch and "Posti".
  - "Gruppi di tavoli": the list; "Nuovo gruppo" with name, seats and table checkboxes; "Disattiva".
- **`/prenotazioni`** (Sala; owner, admin, waiter):
  - a date bar ("Oggi", ‹ ›, a picker);
  - one section per service, headed "N prenotazioni · M coperti · K da confermare";
  - rows with `data-reservation-id`, e.g. "20:00 · 4 persone · Cliente Demo · Tavolo 1 (demo) + Tavolo 2 (demo)", a status badge, and the phone as a `tel:` link;
  - buttons exactly from `actions`:
    - "Accetta" opens a sheet with the suggestion preselected ("Consigliato: Tavolo 3 (demo), 4 posti"), the alternatives, "Scegli tavoli" and "Senza tavolo";
    - "Rifiuta" offers three reasons; "Sposta" asks for date, time and party;
    - "Arrivati", "Non presentati", and "Apri tavolo" (covers prefilled with the party size);
    - "Cancella dati cliente", with a confirmation;
  - it polls `pending-count` and the day every 60 s while visible; nothing is cached offline.
- **`/prenota/[slug]`** (public; `src/app/(public)/prenota/[slug]/{page,request-form,slot-picker,privacy-notice}.tsx`):
  - the venue name; date and party (1…max, then "Per gruppi più numerosi chiamaci" with `venuePhone` if set, else "contattaci direttamente");
  - service tabs and slot buttons; name, phone and e-mail;
  - the honeypot field `website`: placed off-screen by a class, `tabIndex=-1`, `autoComplete="off"`, `aria-hidden`;
  - the short notice and the "Ho letto l'informativa privacy" checkbox (required, not pre-ticked), with the full notice in a `<details>`;
  - "Invia richiesta" → "Richiesta inviata: ti scriveremo via e-mail appena confermata.";
  - an IT/EN switch (`?lang=en`).
- **`/prenota/[slug]/annulla`**: the booking summary, "Annulla prenotazione" and the outcome text; `noindex`.

### 3.6 Who calls what

| Object | owner | admin | waiter | chef | anon | Enforcement |
|---|---|---|---|---|---|---|
| settings, tables, groups (read/write) | ✓ | ✓ | 42501 | 42501 | — | `require_day_closer()` first; the route answers 403 before any RPC |
| `reservations_day`, `reservation_detail` (personal data) | ✓ | ✓ | ✓ (no `emailStatus`, no suggestion) | 42501 | — | `require_table_operator()`; RLS |
| accept, decline, move, assign, erase | ✓ | ✓ | 42501 (V1) | 42501 | — | `require_day_closer()` |
| mark, seat | ✓ | ✓ | ✓ | 42501 | — | `require_table_operator()` |
| `reservation_page`, `reservation_slots`, `request_reservation`, `reservation_cancel_view`, `cancel_reservation` | — | — | — | — | ✓ **with a valid gate** | granted to `anon` only; gate checked first, P0001 `gate_invalid` |
| `reservation_mail_claim`, `reservation_mail_finish` | — | — | — | — | — | `service_role` only (the cron route) |
| table SELECT | RLS per §3.2 | | | 0 rows | none | RLS; no write grant |

### 3.7 Secrets and configuration

| Name | Secret? | Where it lives | Used by |
|---|---|---|---|
| `RESERVATION_GATE_KEY` (≥ 32 chars), **new** | private | Vercel env (server-only) **and** Supabase Vault `reservation_gate_key` (same value); optional Vault `reservation_gate_key_next` during rotation | the public routes (MAC); `app.reservation_gate_ok` |
| `RESERVATION_LINK_KEY` (≥ 32), **new**; `RESERVATION_LINK_KEY_PREVIOUS` (optional) | private | Vercel env (server-only) | the cancel-link and form-token MACs (each with its own purpose prefix), in the public routes and the mail cron |
| Vault `reservation_hash_salt`, **new** | private | Supabase Vault only (never in env) | `app.reservation_hash` |
| `RESEND_API_KEY` (existing placeholder, now read) | private | Vercel env (server-only), production and preview | `src/server/mail/resend.ts`, from the cron only |
| `MAIL_TRANSPORT` (`resend` \| `mailpit`), `MAIL_FROM`, `APP_PUBLIC_ORIGIN`, `MAILPIT_URL`, **new** | config | Vercel env; local `.env`; CI env (`MAILPIT_URL=$E2E_MAILPIT_URL`) | the mail cron. `mailpit` is refused when `VERCEL_ENV=production` |
| `SUPABASE_SECRET_KEY` (existing) | private | as today | **only** `/api/cron/reservation-mail` (through `withCron`); no public or staff reservation route |
| `CRON_SECRET`; Vault `app_base_url`, `cron_secret`, `vercel_protection_bypass` | existing | as today | the mail cron call |
| Account logins: Resend (new), the DNS registrar of the sending and app domains | humans | the account owner's password manager, with MFA (project Q26); never in the repo or DigiAlto-Ops | the founder steps in §8 |

- **`.env.example`** gets the new names with `replace-me` values.
- **`supabase/seed.sql`** creates the three Vault secrets with **fake** local values, equal to the `.env.example` fakes, so local and CI runs work. Staging and production values are created by hand (§8; `docs/guides/cron-vault-secrets.md` is extended).
- **Rotation:**
  - **Link key:**
    1. set `RESERVATION_LINK_KEY_PREVIOUS` = the old key and `RESERVATION_LINK_KEY` = the new one, then redeploy;
    2. tokens carry a `kid` (the first 8 hex of the SHA-256 of the key), so both keys verify;
    3. delete PREVIOUS after `horizon_days`, when every older link has expired.

    In an emergency, drop PREVIOUS at once; old links then show "link non valido, chiamaci".
  - **Gate key**, with no downtime:
    1. add the new value as Vault `reservation_gate_key_next`;
    2. set the env and redeploy;
    3. move the value to `reservation_gate_key` and delete `_next`.
  - **Salt:** change it at any time; only the day's counters reset.

### 3.8 CSP (ADR-028) and the public page

- The page is built to ADR-028's nonce policy, which reaches `main` with M25:
  - no inline script, no `next/script`, no `dangerouslySetInnerHTML`, no `style=""`, no third-party origin;
  - the browser calls only `/api/*` (`connect-src 'self'`);
  - the form submits by `fetch` to self, so `form-action 'self'` holds;
  - fonts come through `next/font`;
  - the page renders per request, as it would under ADR-028 anyway.
- **Coexistence with M25:**
  - If PR2 merges before M25, the page runs under today's baseline headers and gains the nonce policy when M25 merges.
  - If PR2 merges after M25, `e2e/reservations-public.spec.ts` runs under M25's CSP-violation collector, which must report `[]`.
  - Either way, B11's Vitest guard holds: no inline script or style and no external URL in `src/app/(public)/prenota/**`.
- The proxy must not redirect `/prenota/*` to `/login`, so `PUBLIC_PREFIXES` gains `/prenota` (B11).
- Only the staff outbox hook (`src/pwa/use-outbox.ts`) registers the service worker, so customers never install it.

### 3.9 GDPR

- **Roles:**
  - the restaurant (tenant) is the **controller**;
  - DigiAlto is the **processor**, and a DPA is needed (project Q13);
  - sub-processors: Supabase (EU), Vercel (EU functions), **Resend (new; location and retention: Q-R14)**, and Sentry (no personal data: codes only, `sendDefaultPii` off).
- **Lawful basis:**
  - GDPR Art. 6(1)(b): steps taken **at the request of the data subject before entering into a contract** (the table booking).
  - Consent is **not** the basis, so the checkbox is **not consent**. It records that the notice was shown and read (Art. 13, accountability). The stored proof is `privacy_ack_at` + `privacy_notice_version`.
  - No marketing, no profiling, no newsletter box.
- **Data minimisation:**
  - collected: name, phone, e-mail, party, date/time, language;
  - no free-text note, because allergies are health data (Art. 9; Q-R13);
  - IP, e-mail and phone are also kept as daily-salted HMACs for 2 days, for abuse prevention. The basis for that is Art. 6(1)(f), legitimate interest, stated in the notice.
- **Privacy notice** (a draft, it/en in `src/lib/i18n/messages`):
  - controller: `privacyControllerName`, the VAT number (`tenant.vat_number`) and `privacyContactEmail`. These are tenant settings, and **the real values are pending** (placeholders in `docs/client-facts.md`, B13);
  - purposes and basis;
  - recipients: the venue's staff; the processors DigiAlto, Supabase, Vercel and Resend;
  - retention: deleted `retentionDays` after the booked date; abuse hashes kept 2 days;
  - rights: access, rectification, erasure, restriction, objection to the abuse check, and a complaint to the Garante;
  - "providing the data is necessary to handle the request".

  **The text is a DigiAlto draft; the client must approve it before go-live (Q-R12).** Its version string `RESERVATION_NOTICE_VERSION` (`src/server/reservations/constants.ts`) is bumped with every text change.
- **Retention:**
  - the contact is deleted `retention_days` (default 30, Q-R11) after `business_date`, for declined, cancelled and expired requests too;
  - the anonymous row is kept;
  - erasure on request: owner/admin "Cancella dati cliente" (A5);
  - outbox rows never hold personal data;
  - backups (M25: 14 daily copies) still hold deleted contacts until they rotate out. The notice says so.
- **Logs:** no personal data in logs, URLs, error messages or DETAILs. The cancel token holds an id and a MAC, nothing personal. Asserted in A3, B7 and B10.
- **Records of processing** (an entry for the controller's register; a founder step):

  | Field | Entry |
  |---|---|
  | Processing | Table reservation requests via the online booking page |
  | Controller / processor | Restaurant `[legal name PENDING]` / DigiAlto (DPA) |
  | Categories of data subjects | Customers asking for a table |
  | Categories of data | Name, phone, e-mail, party size, date/time, language; pseudonymous daily hashes of IP, e-mail and phone |
  | Purpose / basis | Handling the request and telling the outcome / Art. 6(1)(b); abuse prevention / Art. 6(1)(f) |
  | Recipients | Venue staff (owner, admin, waiters); processors DigiAlto, Supabase, Vercel, Resend |
  | Transfers outside the EU | Resend: to confirm (Q-R14) |
  | Retention | `retention_days` after the visit (default 30); hashes 2 days; backups up to 14 days more |
  | Security | RLS by role, TLS, EU hosting, secrets in env/Vault, no personal data in logs |

## 4. Alternatives considered

- **A secret-key insert from the public route** (a second `privileged.ts`-style exception to rule 2): rejected. It would hand full database power to the only unauthenticated write route (ADR-032).
- **A plain anon-granted function without a gate:** rejected. The publishable key is public, so anyone could call the function directly with a fake IP and skip the honeypot and the fill time. The gate costs one HMAC.
- **Anon INSERT with an RLS `with check` policy:** rejected. There is no room for the slot rules, locks, throttling, the outbox and the event in one transaction, and anon would gain a table privilege.
- **A Supabase Edge Function for the public write:** rejected. It is a second runtime, deploy path and secret store for one endpoint, while the Next.js route already has `withApi`, Zod and tests.
- **Sending e-mail inline from the routes:** rejected.
  - The customer and the staff would wait on the provider.
  - A failure would lose either the e-mail or the state change.
  - Retries and idempotency would be duplicated across four routes, and the staff routes would need the Resend key.
  - The outbox is written in the same transaction as the state change and has one sender. Its cost is up to about a minute of delay.
- **The `resend` npm package** (project plan §3.12): not added. One `fetch` to `POST https://api.resend.com/emails`, with `Authorization: Bearer` and `Idempotency-Key`, is about 30 lines and keeps `no-new-deps` green (source as cited in the M6 plan: <https://resend.com/docs/dashboard/emails/idempotency-keys>; T-R2).
- **One `table_session` over several tables:** rejected (decision 8).
- **Seats and bookable as columns on `dining_table`:** rejected. They would need `create_dining_table`, `update_dining_table` and `dining_tables_manage` replaced and re-pinned; a side table is additive.
- **Tenant by host name now:** deferred to V5. There is a single venue and no custom domain yet, and a path slug works on staging and preview.
- **A CAPTCHA (Turnstile, hCaptcha) by default:** rejected for now. It needs a third-party script and origin in the CSP, a new sub-processor and a cookie/notice change, for a form whose requests staff approve by hand anyway (V3).
- **A cancel link with a random token stored hashed (no HMAC):** equally secure, but every garbage token costs a database read, and each e-mail needs a stored column. The HMAC rejects garbage in the route and needs no storage. Single use comes from the status change.
- **Status derived only from events (like `service_override`):** rejected. Capacity checks and the day view read the current status many times per request. A guarded status column plus the event ledger keeps both cheap and auditable.

## 5. Build plan (test first: each step's named test is written and seen failing, then the code; one commit per step)

### PR1 — data model, settings, staff side (`feat/reservations`)

| # | Step (one commit) | Files | Test that proves it (written first, must fail first) |
|---|---|---|---|
| A1 | **Tables, guards, RLS, purge list, shared lists** | `supabase/migrations/20261124100000_reservation_core.sql`, `…100100_demo_purge_tables_resv.sql`, `supabase/tests/database/290_reservation_core.test.sql`; pgTAP `207`, `214`, `222`, `229`, `240` (lists); the M0 waiter-columns test fixture; `tests/config/reservations-preserves.test.ts`; `tests/config/{m25a,m25b,m25,m25c}-preserves.test.ts` | **`290` grants and RLS:** each of the eight public tables has `tenant_id` and RLS, and no INSERT/UPDATE/DELETE grant for `anon`, `authenticated` or `service_role` (an insert as owner → 42501). `anon` has no privilege on any of them. Owner, admin and waiter of A see A's `reservation` and `reservation_contact` rows; the chef sees 0 rows; owner B sees none of A's. `reservation_settings`, `dining_table_booking`, `table_group*` and `reservation_email`: owner/admin see rows, waiter and chef 0 rows. **Guards** (as the migration owner): updating `reservation.created_at` → `reservation_immutable`; status `declined → accepted` → `status_invalid`; `table_session_id` set twice is refused; `reservation_event` update/delete/truncate → the append-only error; a `table_group_member` delete is refused; a `reservation_contact` delete is refused without the local flag and allowed with it; a `reservation` delete is refused. **Cross-tenant FK:** a `reservation_table` of A pointing at B's table → FK violation. **Purge:** the names sit in the shared-list positions, each once; for a demo tenant with a reservation, contact, event, e-mail, assignment, group and settings, `app.purge_demo_data_core` removes all of them and the other tenant's rows stay. **Columns:** no column of the new tables matches `cost\|margin\|price\|eur\|total`. **`reservations-preserves.test.ts`:** the `20261124*` SQL replaces only `app.demo_purge_tables`; no `create or replace` of `public.open_table`, `public.tables_list`, `public.close_table`, `app.table_session_guard`, `app.session_services`, any `app.kpi_*` or `public.enter_day_close`; no `alter table` of `public.table_session`, `dining_table` or `day_close`; the created tables are exactly the nine of §3.2 |
| A2 | **Settings, bookable tables, groups** | `…20261124100200_reservation_settings.sql`, `supabase/tests/database/291_reservation_settings.test.sql`, pgTAP `229` (names), `tests/config/check-constraint-union.test.ts` | **Defaults** for a tenant with no row: each default of §3.2 asserted; `enabled` false; `ready` false with the reasons `slug, privacy_name, privacy_email, seating`; services listed from the M25c version (Pranzo, Cena) with `online` false. **Saves:** each field's bounds on both sides (e.g. `slot_minutes` 15 ok, 20 → reason `slot_minutes`); `firstSeating` after `lastSeating` → `services`; an unknown body key → 22023; `enabled: true` while not ready → `reservations_not_ready` with the reasons; a slug used by B → `slug_taken`; an identical save → `changed` false and no audit row; a real save → one `audit_event` `reservation_settings.changed` with field names only. **Tables:** B's table id → `table_not_found`; seats 0 and 41 are refused. **Groups:** one table → `tables`; a duplicate active name → `name_taken`; deactivating and then recreating the same name works; members are immutable. **Roles:** waiter and chef → 42501 **before** parsing. Every function is a definer with an empty `search_path`, executable by `authenticated` only |
| A3 | **Slots and request core** | `…20261124100300_reservation_request_core.sql`, `supabase/tests/database/292_reservation_request.test.sql`, `scripts/test-db-races.sh` (case `resv_slot_limit`) | **Fixture:** tenant A, Europe/Rome, cut-off 02:00, the default services; Cena online 19:00–21:30, slot 15, lead 120, horizon 60, max 8, `reservationsPerSlot` 2; the Vault salt is created in the test (T-R5); `p_now` fixed. **Slots** for 2026-11-20, party 2: 19:00…21:30 (11 slots). With Friday in `closed_weekdays` → `closed` true; a date in `closed_dates` → closed. **Valid request** → one reservation (`pending`, `business_date`, `service_key` cena, `ends_at` = +120 min), one contact (phone digits only, e-mail lower-case), event `requested`, one `received` e-mail row; the reply is exactly `{status:"received"}`. **Each reason:** 21:45 → `seating`; 19:10 → `grid`; `p_now` = start − 119 min → `lead`, start − 120 → ok; horizon day 60 ok, 61 → `horizon`; party 8 ok, 9 → `party`; the second request in a slot ok, the third → `slot_limit`; `coversPerService` 10 with 8 covers booked + party 3 → `service_limit`; `serviceKey` pranzo at 20:00 → `service`; 2027-03-28 02:30 inside a booking window → `dst_gap`; only a bookable table with 4 seats + party 6 → `no_fit`, while with no seats configured anywhere → ok. **Time zone** (`p_now` 2027-03-01): 2027-03-26 20:00 (CET) → `starts_at` 19:00Z; 2027-03-29 20:00 (CEST) → 18:00Z. **Throttle:** 5 requests from one IP ok, the 6th → `rate_limited`; 3 per e-mail (case-insensitive) and per phone (`+39 000 0000001` = `390000000001`); the next local day resets the counters; no column anywhere holds the raw IP (a scan of `app.reservation_throttle` and every new table for `'203.0.113.'`); the raised error texts carry no name, e-mail or phone. A missing salt → `reservations_unconfigured`. **Race `resv_slot_limit`:** two sessions request the last place in a slot at once → exactly one row; the other gets `slot_limit`. `extensions.hmac` exists after the migration (T-R3) |
| A4 | **Suggestion** | `…20261124100400_reservation_suggest.sql`, `supabase/tests/database/293_reservation_suggest.test.sql` | Tables T1 (2 seats), T2 (4), T3 (4, positioned before T2), T4 (6, not bookable); group "T1+T2" (6 seats). Party 3 → T3 (fewest seats, then position). T3 held 20:00–22:00 → T2. T2 and T3 held → the group T1+T2 (6). A reservation ending at 20:00 does not block one starting at 20:00. Party 7 → null. T4 is never suggested. At most 5 alternatives, in order. A declined or cancelled reservation does not hold a table. Tenant B's tables never appear |
| A5 | **Staff actions** | `…20261124100500_reservation_staff.sql`, `supabase/tests/database/294_reservation_staff.test.sql`, pgTAP `229` (names), `scripts/test-db-races.sh` (cases `resv_accept_same_table`, `resv_seat_vs_close`) | Each row of the §3.2 table. **Accept:** with the suggestion → `accepted`, assignment rows, an event, an `accepted` e-mail queued; `tableIds` held by an overlapping accepted reservation → `table_taken`; a `groupId` with other `tableIds` → `group_mismatch`; at `p_now` = start → `reservation_expired`, start − 1 s ok. **Decline:** pending and accepted → `declined`; tables released (`released_at` set, rows kept); one `declined` e-mail. **Move:** a new slot; tables released; the reply has a suggestion; a move inside the lead time and with party 12 is allowed for staff. **Mark:** arrived the day before → `too_early`, on the day ok; no_show at start − 1 s → `too_early`, at start ok. **Seat:** an open session on an assigned table → `seated` with `table_session_id` set; a session on an unassigned table → `table_not_assigned`; a closed session → `session_closed`; B's session → `session_not_found`. **Erase:** the contact is gone, event `contact_erased`, the queued e-mail is `skipped`, the reservation stays. Same-state requests → `changed` false. **Roles:** waiter → 42501 on accept/decline/move/assign/erase, ok on mark/seat; chef → 42501 on all. **Races:** two accepts of different reservations onto one table at once → one ok, one `table_taken`; seat vs `close_table` of the same session → both orders end consistent, with no deadlock |
| A6 | **Reads** | `…20261124100600_reservation_reads.sql`, `supabase/tests/database/295_reservation_reads.test.sql`, pgTAP `229` (names) | `reservations_day('2026-11-20')` on the A5 fixture: services in M25c order, with totals; rows ordered by `startsAt`, then id; a pending row past its start reads `expired`; `joinedTo` = the lead table for the second table of a two-table assignment. **`actions` per role:** owner on pending → `accept, decline, move, erase`; waiter on an accepted booking on its day → `arrived, no_show, seat`; the waiter never gets `accept`. The waiter's reply has no `emailStatus` key and no `suggestion`. An erased contact → `name`, `phone`, `email` null. Chef → 42501. B's reservation is never listed. `reservation_detail` events carry only `kind` and `at`. No key in any reply matches `/eur\|cost\|price\|margin\|total/i` (a recursive key scan) |
| A7 | **SQL preserves** | `supabase/tests/database/296_reservations_preserves.test.sql` | The md5 of `prosrc` of `public.open_table`, `public.tables_list`, `public.close_table`, `app.close_session_at`, `app.table_session_guard`, `app.session_services`, `app.kpi_service_split`, `app.app_vs_register_json`, `public.enter_day_close`, `app.rollup_daily_kpi` and `app.apply_op_dispatch` equals its value on the rebased `main` (written into the test). The `cron.job` names and the alert registry are unchanged in PR1 |
| A8 | **Settings and tables API** | `src/server/reservations/{constants,schemas,output,errors,settings,tables}.ts`, `src/app/api/settings/reservations/route.ts`, `src/app/api/settings/reservations/tables/route.ts`, `src/app/api/table-groups/route.ts`, `src/app/api/table-groups/[id]/deactivate/route.ts`, `src/lib/api/errors.ts`, `src/lib/i18n/messages/{it,en}.ts`, `tests/app/api/settings-reservations.test.ts`, `tests/app/api/table-groups.test.ts`, `tests/parity/reservation-constants.test.ts` | **Parity:** the TS bounds (slot set, stay, lead, horizon, party, retention, slug regex, limits) equal the SQL checks, read from the migration text. **Routes:** waiter and chef → 403 with 0 RPCs; signed out → 401; 5 KB → 413; text/plain → 415; an unknown key → 400 without an RPC; P0001 `reservations_not_ready` → 422 with `details.reasons` and an it/en message per reason (key parity); `slug_taken` → 409; a reply with an extra key → 500. Snapshots |
| A9 | **Reservations read API** | `src/server/reservations/day.ts`, `src/app/api/reservations/route.ts`, `src/app/api/reservations/[id]/route.ts`, `src/app/api/reservations/pending-count/route.ts`, `tests/app/api/reservations-read.test.ts` | `?date=2026-13-01` → 400; chef → 403 with 0 RPCs; waiter → 200, parsed by the strict waiter schema (an `emailStatus` key → 500); owner → 200; a malformed id → 404 without an RPC; `Cache-Control: no-store`; response bodies are never logged (the `reportError` spy sees codes only) |
| A10 | **Actions and seat API** | `src/server/reservations/{actions,seat}.ts`, `src/app/api/reservations/[id]/{accept,decline,move,tables,mark,seat,erase-contact}/route.ts`, `tests/app/api/reservations-actions.test.ts`, `tests/server/reservations/seat.test.ts` | **Roles:** waiter → 403 with 0 RPCs on accept/decline/move/tables/erase, 200 on mark/seat. **Error mapping:** `status_invalid`, `table_taken`, `reservation_expired`, `too_early` → 409; `slot_unavailable` → 422 with its reason. **Seat:** the RPCs run in the order `open_table` (`p_table` = the lead id from the detail, `p_session`, `p_covers`), then `seat_reservation`; `open_table` → `table_already_open` → 409, with no second RPC; a retry with the same `sessionId`, after `open_table` replied `created:false`, still calls `seat_reservation` and succeeds |
| A11 | **Settings cards** | `src/app/(owner)/tavoli/impostazioni/{page,reservations-card,booking-tables-card,table-groups-card}.tsx`, `src/lib/reservations/settings-view.ts`, `tests/components/reservations-settings.test.ts` | The page makes its two extra reads in parallel. The switch is disabled and the `notReady` checklist is shown. Saving sends exactly the edited body. A 422 shows the server's message in `aria-live`. The slug preview shows `<origin>/prenota/<slug>`. Per-service rows come from the reply (Pranzo, Cena). "Posti" accepts 1–40. "Nuovo gruppo" sends `{name, seats, tableIds}`. Targets ≥ 44 px. The helpers only format (no arithmetic on reply numbers) |
| A12 | **Prenotazioni page** | `src/app/(owner)/prenotazioni/{page,day-view,reservation-row,accept-sheet,move-sheet,decline-sheet}.tsx`, `src/lib/reservations/day-view.ts`, `src/lib/i18n/messages/{it,en}.ts`, `tests/components/reservations-day.test.ts` | A fixture reply renders one section per service headed "2 prenotazioni · 6 coperti · 1 da confermare", with rows found by `data-reservation-id`. Buttons exactly = `actions` (the waiter fixture has no "Accetta"). The accept sheet preselects the suggestion; "Senza tavolo" sends `{tableIds:null, groupId:null}`; a 409 `table_taken` puts its message in `aria-live` with no re-read. "Apri tavolo" posts `{sessionId: <uuid v4>, covers: party}` and, on 200, navigates to `/tavoli/comanda?session=<id>`. `joinedTo` renders "unito a Tavolo 1 (demo)". The phone renders as `tel:`. An erased contact shows "Dati cancellati". Polling every 60 s happens only while `document.visibilityState === "visible"` (fake timers) |
| A13 | **Nav** | `src/lib/nav/nav-model.ts`, `tests/lib/nav/nav-model.test.ts`, `e2e/app-shell.spec.ts` (routes), `tests/guards/back-link.test.ts` | `/prenotazioni` is in group `sala` for owner, admin and waiter, and absent for the chef. `currentSection("waiter","/prenotazioni")` = Sala. The shell lists are updated on purpose; the back-link guard stays green |
| A14 | **Integration** | `tests/integration/reservations-staff.int.ts`, `tests/integration/helpers/reservations.ts` (creates requests through `psql` calling `app.request_reservation_at`, the way `staff-pin.int.ts` uses psql) | Real stack; dates from `GET /api/tables` `businessDate` + 1. Owner A sets tables, a group and Cena's booking times, then seeds two requests; `GET /api/reservations` lists them as pending. Accepting one with the suggestion works; a second accept on the same table → 409. The waiter (PIN) sees the customer data, cannot accept (403), and can mark arrived on the day (the helper moves a booking to today, inside the lead time, via `move`). Seating creates a real `table_session` on the lead table with covers = party. After the session closes through `helpers/closing.ts`, `GET /api/day-close/services` counts it in Cena like any table. Chef → 403 everywhere. Owner B sees none of A's ids. `reservation_email` rows are queued (read with psql) and nothing is sent |
| A15 | **Playwright (staff, lean) and docs** | `e2e/reservations-staff.spec.ts`, `e2e/helpers/reservations.ts`, `docs/design/ui-foundation.md` (a §8 line), `docs/plans/2026-10-21-project-plan.md` (§3.11.8: one line "Exception (founder 2026-11-08): reservations hold customer contact data; see `docs/plans/2026-11-08-reservations.md` §3.9 and ADR-032") | `phone` project. The owner signs in and configures tables and a group; a seeded request appears on `/prenotazioni`; "Accetta" with the suggestion → the row shows "Confermata" and the table name. As the waiter (a second context), "Apri tavolo" opens the comanda for that table. As the chef, `page.request.get("/api/reservations")` → 403. `expectPhoneFriendly` on `/prenotazioni`. The docs change is checked in code review |

### PR2 — public page, e-mails, retention (`feat/reservations-public`, after PR1 merges)

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| B1 | **Gate and anon wrappers** | `supabase/migrations/20261125100000_reservation_public.sql`, `supabase/seed.sql` (fake Vault values), `supabase/tests/database/297_reservation_public.test.sql`, pgTAP `229` (names), `tests/config/reservations-preserves.test.ts` and `tests/config/{m25a,m25b,m25,m25c}-preserves.test.ts` (the `20261125*` names allowed) | **`app.reservation_gate_ok('request_reservation', slug, ts, mac, p_now)`:** the RFC 4231 HMAC-SHA256 vector is reproduced by `extensions.hmac` (T-R3). A MAC with the right key at `ts` = now ± 60 s ok; ± 61 s → `gate_invalid`. The `_next` key is also accepted. A MAC for another function or slug is refused. No Vault key → `reservations_unconfigured`. **Grants:** the five public functions are executable by `anon` only (not `authenticated`, not `service_role`), each `prosecdef` with an empty `search_path`. As `anon` without a valid gate → `gate_invalid` **before** any other check (a malformed body still gives `gate_invalid`). With a valid gate, `request_reservation` behaves as in A3 (one valid case, one `slot_unavailable`). `reservation_page` gives the same P0002 `not_found` for a disabled tenant, a not-ready tenant and an unknown slug. `anon` still has no table privilege |
| B2 | **Cancel by link (SQL)** | `…20261125100100_reservation_cancel.sql`, `supabase/tests/database/298_reservation_cancel.test.sql`, pgTAP `229` (names) | `cancel_reservation(gate…, slug, reservationId, exp)` on pending and accepted → `cancelled`, tables released, event `cancelled_by_customer`. A second call → `already: true` and no new event (single use). `p_now` = exp − 1 s ok; = exp → `cancel_closed`. A start moved earlier than `exp` → `cancel_closed` at the new start. A reservation of tenant B with A's slug → `not_found`, the same as unknown. Declined or seated → `status_invalid`, which the view reports as `canCancel: false`. `reservation_cancel_view` returns no name, phone or e-mail key |
| B3 | **Mail outbox SQL and cron** | `…20261125100200_reservation_mail.sql`, `supabase/tests/database/299_reservation_mail.test.sql`, pgTAP `229` (names), `tests/config/check-constraint-union.test.ts`, `scripts/test-db-races.sh` (case `resv_mail_claim`) | `app.reservation_mail_due()` is false with nothing due and true with one queued row. `reservation_mail_claim(10)` as `service_role` returns at most 10 rows with `to`, `locale`, `kind`, the venue name, date/time/party, the service name and `cancelExp`, and sets `sending` + a lease. A second concurrent claim skips those rows (SKIP LOCKED, race `resv_mail_claim`). An expired lease is claimable again. `finish(ok)` → `sent` with `sent_at`; `finish(error)` → backoff 1, 5, 15, 60 min, then `failed` at attempt 5. A row whose contact is gone → `skipped`, with no send. `authenticated` and `anon` → 42501 on claim and finish. `cron.job` has `reservation-mail` at `* * * * *` with the `where app.reservation_mail_due()` command. `job_run_job_check` accepts `reservation-mail` |
| B4 | **Retention job** | `…20261125100300_reservation_retention.sql`, `supabase/tests/database/300_reservation_retention.test.sql`, `tests/config/check-constraint-union.test.ts` | `app.run_reservation_retention(p_now)` with `retention_days` 30: the contact of a reservation dated `today − 31` is deleted (event `contact_purged`); `today − 30` is kept (the edge). Declined and cancelled rows are purged by the same date rule. The reservation row stays. A pending request past its start → `expired` + an event. Throttle rows with `day < today − 2` are deleted; `today − 2` is kept. Queued e-mails of purged contacts → `skipped`. `retention_days` 7 is respected. One `job_run` row `reservation-retention`. `cron.job` `reservation-retention` at `20 3 * * *`. `app.job_health_checks` raises its health finding when the job has not succeeded for 48 h (the existing check pattern) |
| B5 | **SQL preserves (PR2)** | `supabase/tests/database/301_reservations_public_preserves.test.sql` | The `296` md5 pins still hold. The only `anon`-executable functions in `public` are the five of B1–B2: a catalogue scan fails on any other `anon` grant. The `cron.job` names = the PR1 list + `reservation-mail`, `reservation-retention` |
| B6 | **Env and tokens** | `src/lib/env/index.ts`, `.env.example`, `src/server/reservations/public/tokens.ts`, `src/server/reservations/public/gate.ts`, `tests/lib/env/reservation-env.test.ts`, `tests/server/reservations/tokens.test.ts` | **`readReservationEnv`:** a missing or < 32-char `RESERVATION_GATE_KEY` or `RESERVATION_LINK_KEY` → `ConfigError` naming the variable, never the value. **`readMailEnv`:** `MAIL_TRANSPORT=mailpit` with `VERCEL_ENV=production` → `ConfigError`; `resend` without `RESEND_API_KEY` → error. **Tokens:** the cancel token round-trips; a flipped MAC byte, a wrong `kid` or a past `exp` → `null`; a token signed with PREVIOUS verifies while PREVIOUS is set and fails after it is removed; a form token aged 2 999 ms → `too_fast`, 3 000 ok, 2 h + 1 ms → `expired`. Comparisons use `timingSafeEqual` on equal-length digests (spy). The gate MAC equals the SQL's for a fixed key, function, slug and ts (a vector shared with B1). `.env.example` lists the new names with `replace-me` |
| B7 | **Public request API** | `src/lib/supabase/anon.ts`, `src/server/reservations/public/{schemas,output,page,slots,request}.ts`, `src/app/api/public/reservations/[slug]/{page,slots,requests}/route.ts`, `tests/app/api/public-reservations.test.ts`, `tests/guards/anon-client-importers.test.ts` | The anon client sends no cookies: a staff cookie on the request is ignored, and the RPC uses the publishable key only. Only `src/server/reservations/public/*` imports it (guard). A POST without `Origin` or with a foreign one → 403 with 0 RPCs. 5 KB → 413. A filled `website` → 202 and **0 RPCs**. `privacyAck: false` → 400. A fast form → 422 `form_too_fast`. `rate_limited` → 429. `slot_unavailable` → 422 with `details.reason` and the it/en message. `reservations_unconfigured` → 503. `not_found` → 404 with an identical body for unknown and disabled. The IP passed is the first `x-forwarded-for` entry (T-R4). No route imports the admin or privileged client (the existing guards stay green). The error reporter never receives the name, phone, e-mail or IP (a spy on `reportError`, with a fixture containing them) |
| B8 | **Public cancel API** | `src/server/reservations/public/cancel.ts`, `src/app/api/public/reservations/[slug]/cancel/route.ts`, `tests/app/api/public-cancel.test.ts` | Garbage, a bad MAC, a wrong kid or an expired token → 404 `link_invalid` with **0 RPCs** and identical bodies. A valid token → the `reservation_cancel_view` RPC. POST → `cancel_reservation`; `already: true` passes through. `X-Robots-Tag: noindex`. GET never cancels: no write RPC on GET |
| B9 | **Mail abstraction and templates** | `src/server/mail/{types,resend,mailpit,index}.ts`, `src/server/reservations/mail/{templates,render}.ts`, `src/lib/i18n/messages/{it,en}.ts`, `tests/server/mail/resend.test.ts`, `tests/server/mail/mailpit.test.ts`, `tests/server/reservations/mail-render.test.ts` | **Interface:** `MailSender.send({to, from, subject, text, html, idempotencyKey}) → {providerId}`. **Resend** (fetch mocked): `POST https://api.resend.com/emails`, `Authorization: Bearer <key>`, `Idempotency-Key: <outbox id>`, JSON body `{from, to:[to], subject, text, html}`; 2xx → `id`; 429/5xx → `MailError("retry")`; other 4xx → `MailError("rejected")`; the key never appears in thrown messages (T-R2). **Mailpit:** `POST <MAILPIT_URL>/api/v1/send` with its JSON shape (T-R1). `index.ts` picks the sender by `MAIL_TRANSPORT`. **Render:** snapshots of `received`/`accepted`/`declined` × it/en. `received` and `accepted` carry the cancel URL `<APP_PUBLIC_ORIGIN>/prenota/<slug>/annulla?t=<token>`; `declined` has none. A `name` of "<b>Demo</b>" is escaped in the HTML. Dates are in Europe/Rome ("ven 20 novembre 2026, 20:00"). No `€` and no table name in any template |
| B10 | **Mail cron route** | `src/server/cron/with-cron.ts` (`CronJob` widened), `src/server/cron/reservation-mail-job.ts`, `src/app/api/cron/reservation-mail/route.ts`, `tests/app/api/cron/reservation-mail.test.ts`, `tests/guards/admin-client-importers.test.ts` | Without the bearer → 401 and 0 RPCs. Per row, in order: claim → render → send → finish. One failing send does not stop the others. `MailError("retry")` → `finish(false, "retry")`. `job_run` items = the rows handled. The `maxDuration` literal is pinned. Logs carry row ids and codes only |
| B11 | **Public pages** | `src/app/(public)/prenota/[slug]/{page,request-form,slot-picker,privacy-notice}.tsx`, `src/app/(public)/prenota/[slug]/annulla/{page,cancel-view}.tsx`, `src/lib/reservations/public-view.ts`, `src/lib/supabase/proxy.ts`, `tests/lib/supabase/proxy.test.ts`, `tests/components/reservation-request.test.ts`, `tests/components/reservation-cancel.test.ts`, `tests/guards/public-page-csp.test.ts` | **Proxy:** `/prenota/x` signed out → no redirect; `/prenotazioni` signed out → `/login` (the prefix boundary). **Form:** slot buttons come from the reply only. The party select stops at `maxPartyOnline` and shows "chiamaci", with or without `venuePhone`. Submit is disabled until `privacyAck`. The honeypot is in the DOM, off-screen by class, with `tabIndex -1`. The body sent has exactly the §3.4 keys. 202 → the success text; the 422 reasons → their messages; 429 → "Troppe richieste…"; `?lang=en` → English. **Cancel page:** GET shows the summary and a button; only the click POSTs. **CSP guard:** no `<script`, `dangerouslySetInnerHTML`, `next/script`, `style=` or `http(s)://` literal in `src/app/(public)/prenota/**` |
| B12 | **Integration (real stack)** | `tests/integration/reservations-public.int.ts`, `tests/integration/helpers/reservations.ts` | The owner enables tenant A with fake privacy data and slug `osteria-demo-a`. `GET …/page` → 200 with a form token. A request after 3 s → 202. The test then calls the cron route with the CI `CRON_SECRET` (instead of waiting for pg_cron); Mailpit then holds the "received" e-mail to `cliente.demo@example.com` with a cancel link. A **direct PostgREST call** of `request_reservation` with the publishable key and a made-up gate → `gate_invalid`, with no row written. The 6th request from one `x-forwarded-for` → 429. The owner accepts → the "accepted" e-mail. Opening the cancel link and POSTing → `cancelled`; a second POST → `already: true`. A disabled tenant → 404 |
| B13 | **Playwright (public, lean) and docs** | `e2e/reservations-public.spec.ts`, `docs/client-facts.md`, `docs/guides/cron-vault-secrets.md`, `docs/guides/prenotazioni.md` (runbook: enable, rotate keys, erase on request) | `phone` project, no sign-in: on `/prenota/osteria-demo-a`, pick a date, party and slot, fill in the form, tick the box, wait ≥ 3 s, "Invia richiesta" → the success text. Mailpit (`E2E_MAILPIT_URL`) has the e-mail. Following its cancel link → "Annulla prenotazione" → confirmed. The CSP-violation collector (once M25 is merged) reports `[]`. `expectPhoneFriendly`. **Docs:** `docs/client-facts.md` gains `- Legal name: [PENDING founder]`, `- VAT number: [PENDING founder]`, `- Privacy contact e-mail: [PENDING founder]` and `- Booking hours per service: [PENDING founder]`. The Vault guide lists `reservation_gate_key`, `reservation_gate_key_next` and `reservation_hash_salt` |

### Acceptance tests (AT-R, §5a style)

| # | Requirement → proof | Step(s) | Command |
|---|---|---|---|
| AT-R1 | A customer on a 360 px phone, signed out, sends a request (date, service, time, party, name, phone, e-mail) in Italian or English and never sees a table | B11, B13 | `npm test`; `npx playwright test` |
| AT-R2 | The request stays `pending` until owner or admin accept or decline it. The customer gets the "received", "accepted" or "declined" e-mail; each except "declined" carries a working cancel link | A5, B3, B9, B12, B13 | `npx supabase test db`; `npm run test:integration` |
| AT-R3 | Owner, admin and waiter see the day by service, with name and phone. The chef gets 403/42501 and 0 rows. No € or cost key anywhere | A1, A6, A9, A14, A15 | as above |
| AT-R4 | Owner and admin accept, decline, move and assign. Waiters mark arrived/no-show and open the table, and cannot accept (default) | A5, A10, A14 | as above |
| AT-R5 | On accept the smallest free table or group is suggested; staff can override; a held table → 409 | A4, A5, A12 | as above |
| AT-R6 | A seated combined booking is one ordinary `table_session` on the lead table. Its bill, covers, Pranzo/Cena and day close are unchanged, and the pinned functions are unchanged | A5, A7, A14 | as above |
| AT-R7 | The capacity rules (slot, stay, lead, horizon, party maximum, closed days, per-slot and per-service limits) are tenant settings with defaults, enforced in SQL | A2, A3, A8 | as above |
| AT-R8 | The public write path cannot be used without the route: a direct anon RPC → `gate_invalid`. Honeypot, fill time, Origin and the daily IP/e-mail/phone limits are enforced. No raw IP is stored | A3, B1, B7, B12 | as above |
| AT-R9 | Cancel links are HMAC-signed, expire, work once, and reveal nothing for a wrong or foreign token | B2, B6, B8, B12 | as above |
| AT-R10 | Contacts are deleted `retention_days` after the visit (default 30) and on request; the job is watched | A5, B4 | `npx supabase test db` |
| AT-R11 | No Supabase secret key in any public or staff reservation route; secrets only in env/Vault; fakes in `.env.example` | B5, B6, B7, B10 | `npm test` |
| AT-R12 | The public page runs under ADR-028's nonce CSP with no violation and no third-party origin | B11, B13 | `npm test`; `npx playwright test` |

**CI implications:**
- pgTAP `290`–`301`;
- four new race cases (`resv_slot_limit`, `resv_accept_same_table`, `resv_seat_vs_close`, `resv_mail_claim`);
- new Vitest suites;
- two integration suites;
- two lean e2e specs, on `phone` only.

Coverage ≥ 80 % on new TS.

### 5b. Variants

**V1 — Waiters accept and decline** · Trigger: Q-R1 answered "yes" · Replaces steps: the waiter refusals of A5, A6 (`actions`), A10 and A14

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V1.1 | `accept_reservation` and `decline_reservation` gate on `require_table_operator()`. `move`, `assign`, `erase` and the settings stay owner/admin. The waiter's `actions` gain `accept, decline` | `supabase/migrations/20261126100000_resv_waiter_accept.sql`, `supabase/tests/database/310_resv_waiter_accept.test.sql` | A waiter accepts a pending request → ok, e-mail queued; a waiter move → 42501; chef → 42501 |
| V1.2 | The routes' roles are widened; the waiter sees "Accetta" and "Rifiuta" | `src/app/api/reservations/[id]/{accept,decline}/route.ts`, `tests/app/api/reservations-actions.test.ts`, `tests/components/reservations-day.test.ts` | Waiter accept → 200; waiter move still → 403 with 0 RPCs; buttons follow `actions` |

**V2 — The chef sees covers per service (no personal data)** · Trigger: Q-R2 answered "the chef should see how many are booked" · Replaces steps: none (adds to A6, A9, A12)

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V2.1 | `public.reservations_covers(p_date)` for owner/admin/waiter/chef → `{services:[{key, name, reservations, covers}]}`, counting accepted + arrived + seated only | `supabase/migrations/20261126100100_resv_chef_covers.sql`, `supabase/tests/database/311_resv_chef_covers.test.sql` | The chef gets the counts; no key matches `/name\|phone\|email/` except the service `name`; the chef still gets 0 rows from the tables |
| V2.2 | `GET /api/reservations/covers`; a "Prenotati" line on the chef's production screen | `src/app/api/reservations/covers/route.ts`, `src/app/(owner)/produzione/booked-covers.tsx`, `tests/app/api/reservations-covers.test.ts`, `tests/components/booked-covers.test.ts` | Chef → 200 with counts only; waiter → 200; strict reply schema |

**V3 — CAPTCHA (Cloudflare Turnstile)** · Trigger: Q-R7 answered "add a CAPTCHA", after the founder accepts the provider's terms and prices (not estimated here) · Replaces steps: B7's honeypot-only check (the honeypot stays, plus the token); B11's form and CSP guard

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V3.1 | The token is verified server-side before the RPC. Secret `TURNSTILE_SECRET_KEY` (Vercel env) and site key `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. The verification endpoint and fields are taken from the provider's docs at build time, not assumed here | `src/server/reservations/public/captcha.ts`, `src/app/api/public/reservations/[slug]/requests/route.ts`, `src/lib/env/index.ts`, `.env.example`, `tests/server/reservations/captcha.test.ts` | A missing or invalid token → 422 `captcha_failed` with 0 RPCs; provider down → 503; the secret never appears in errors |
| V3.2 | The widget is on `/prenota/[slug]` only. ADR-028's policy gains the provider origin in `script-src`, `frame-src` and `connect-src` **for `/prenota/*` only**. The privacy notice names the provider | `src/lib/security/csp.ts`, `tests/lib/security/csp.test.ts`, `src/app/(public)/prenota/[slug]/request-form.tsx`, `tests/guards/public-page-csp.test.ts`, `src/lib/i18n/messages/{it,en}.ts` | The policy for `/prenota/x` contains the origin; the one for `/tavoli` does not; the e2e violation collector reports `[]` with the test site key |

**V4 — Combined tables locked in Sala** · Trigger: Q-R6 answered "block the joined tables" · Replaces steps: decision 8's "not locked" behaviour; A7's pins of `open_table` and `tables_list` (re-pinned on purpose)

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V4.1 | `public.tables_list` is replaced: a non-lead member of a `seated` reservation's assignment shows `status: "joined"` with `joinedTo {id, name}`. `public.open_table` is replaced: such a table → P0001 `table_joined`. The lock ends when the lead session closes | `supabase/migrations/20261126100200_resv_joined_tables.sql`, `supabase/tests/database/312_resv_joined_tables.test.sql`, pgTAP `214`, `222`, `229`, `240`, `296` (re-pinned) | T1+T2 seated on T1 → `tables_list` shows T2 `joined`; `open_table(T2)` → `table_joined`; after T1 closes, T2 opens; an offline `apply_op` replay of `open_table(T2)` gets the same error; every other M17/M20 `open_table` case stays green |
| V4.2 | The Sala grid shows "Unito a Tavolo 1"; the offline outbox surfaces `table_joined` | `src/server/tables/{output,errors}.ts`, `src/app/(owner)/tavoli/page.tsx`, `tests/components/tables-grid.test.ts`, `tests/app/api/tables.test.ts` | A joined tile is not tappable; the 409 has an it/en message |

**V5 — Tenant by host name** · Trigger: Q-R3 answered "use our own booking domain" (needs the domain, Q-R15) · Replaces steps: the slug resolution of B1, B7 and B11 (the slug path stays as a fallback)

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V5.1 | `reservation_settings.public_host` (unique, lower-case hostname). `reservation_page`, `slots`, `request` and `cancel` accept `p_host` instead of `p_slug` | `supabase/migrations/20261126100300_resv_public_host.sql`, `supabase/tests/database/313_resv_public_host.test.sql` | A's host → A; an unknown host → `not_found`; a host and a slug of different tenants never mix |
| V5.2 | The proxy rewrites `https://<public_host>/` to `/prenota/_host`; the routes read the `Host` header; the e-mail links use the host | `src/proxy.ts`, `src/lib/supabase/proxy.ts`, `src/server/reservations/public/*`, `tests/lib/supabase/proxy.test.ts`, `tests/app/api/public-reservations.test.ts` | A request with `Host: prenota.example.com` reaches tenant A's page; staff paths on that host → 404 |

**V6 — An e-mail when staff move a reservation** · Trigger: Q-R9 answered "tell the customer about the new time" · Replaces steps: A5's move (no e-mail), B3's kind list, B9's templates

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V6.1 | `reservation_email.kind` gains `moved`; `move_reservation` queues it for accepted reservations | `supabase/migrations/20261126100400_resv_moved_email.sql`, `supabase/tests/database/314_resv_moved_email.test.sql`, `tests/config/check-constraint-union.test.ts` | Moving an accepted booking → one `moved` row; moving a pending one → none |
| V6.2 | A `moved` template in it/en, with the old and new time and the cancel link | `src/server/reservations/mail/templates.ts`, `tests/server/reservations/mail-render.test.ts` | Snapshots in it/en; the link is valid for the new start |

**V7 — Mailpit over SMTP** · Trigger: T-R1 false (the Mailpit pinned by the Supabase CLI has no `POST /api/v1/send`) · Replaces steps: B9's `mailpit.ts`; `supabase/config.toml`

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V7.1 | Enable `smtp_port = 54325` in `[inbucket]`. `mailpit.ts` sends over SMTP with `nodemailer` (MIT, actively maintained; it replaces a hand-written SMTP client). It is imported dynamically only when `MAIL_TRANSPORT=mailpit`. The `no-new-deps` allow-list is updated on purpose | `supabase/config.toml`, `src/server/mail/mailpit.ts`, `package.json`, `tests/config/no-new-deps.test.ts`, `tests/server/mail/mailpit.test.ts`, `tests/config/supabase-config.test.ts` | A send reaches Mailpit (read back with `e2e/helpers/mailbox.ts`); with `MAIL_TRANSPORT=resend` the module graph of the cron route does not load nodemailer (a spy on the dynamic import) |

### 5c. Founder answers folded into PR1 (2026-11-08)

**Q-R5, booking hours (changes A2's defaults).** For a tenant with no settings row, the defaults are:
- `pranzo`: `{online: true, firstSeating: "12:00", lastSeating: "14:00"}`;
- `cena`: `{online: true, firstSeating: "19:30", lastSeating: "22:00"}`, where the last slot is the end time.

The limits stay null. Both remain editable in settings. A2's `ready` reasons for a fresh tenant become `slug, privacy_name, privacy_email`, with no `seating`. A service key not in the tenant's M25c version is ignored, as before. A3's fixture keeps its own explicit Cena times.

**Q-R16, staff-typed bookings (new step A5b, after A5).**
- **Who and what:** `public.create_staff_reservation(p_body jsonb)` and its `app.create_staff_reservation_at(…, p_now)` twin, for owner, admin and waiter (`require_table_operator()`); the chef gets 42501.
  - The body is `{date, time, serviceKey, party, name, phone, email?, locale?, tableIds?, groupId?, note: absent}`. Any unknown key → 22023.
  - It writes a reservation with `source = 'staff'`, status `accepted`, and no privacy-ack fields (the check allows this for `staff`), plus a contact whose e-mail is optional, and the event `created_by_staff`.
  - Optional `tableIds` and `groupId` are validated like an accept, and `table_taken` applies.
- **Limits:** staff are not bound by the lead time, the horizon, `max_party_online`, the per-slot or per-service limits, the 15-minute grid or the throttle. Party size stays between 1 and 99. The date must be today or later (business date, Rome); otherwise `date_past`. The time must fall inside a service of that date, so its `service_key` resolves via M25c; otherwise `service`.
- **E-mail:** an `accepted` e-mail is queued only when an e-mail address is given, and its cancel link works as for online bookings.
- **Errors:** they carry codes only.
- **pgTAP `294b_reservation_staff_create`:**
  - the waiter creates a booking → `accepted` + `source staff`;
  - the chef → 42501;
  - no e-mail → no `reservation_email` row; with an e-mail → one `accepted` row;
  - party 12 at 13:05 inside the lead time → ok;
  - yesterday → `date_past`;
  - 16:00 (no service) → `service`;
  - a held table → `table_taken`;
  - B's table → `table_not_found`;
  - `source` cannot be updated;
  - an online request without an e-mail is still refused (`email`).
- **API (A10):** `POST /api/reservations` for owner, admin and waiter, with a strict body schema. Chef → 403 with 0 RPCs.
- **UI (A12):** a "Nuova prenotazione" sheet on `/prenotazioni`, with name, phone, party, date and time required and e-mail optional.

**Q-R6, V4 tables joined while seated, plus split (new step A7b, after A7; replaces decision 8's "not locked").**
- A new migration replaces `public.open_table` and `public.tables_list` with `create or replace` in a NEW file. Applied migrations are never edited.
- **The lock:** while a reservation is `seated` and its lead table's session is open, every other table still assigned to it (`released_at is null`) is joined to the lead.
  - `tables_list` shows it as `status: "joined"` with `joinedTo {id, name}`.
  - `open_table` on it → P0001 `table_joined`. This also covers the offline `apply_op` replay, which calls the same function.
  - The lock ends when the lead session closes, because the reservation's tables are released on close or read as not locked once the session is closed.
  - Lock time limit decided 2026-11-08 (lead): none; the lock lasts while the lead session is open; split or close T1 to release; the tile shows '(oltre l'orario)' after ends_at. `joinedTo` carries `overtime` (true once now is past the seated booking's `ends_at`); it is information only.
  - Seating is strict (review follow-up): `seat_reservation` locks the booking's assigned `dining_table` rows `FOR UPDATE` (the lock `open_table` takes), so it cannot interleave with `open_table` on a joined table. A non-lead table that already has a session of its own is released from the booking with a `tables_split` event rather than refusing the seat, because that party is another party's. A booking can only be seated on its own business day (`not_today` after it, `too_early` before it).
- **Split** (`public.split_reservation_tables(p_reservation uuid, p_tables uuid[] default null)`): owner, admin or waiter; the chef gets 42501. It releases the given non-lead tables (or, if null, all non-lead tables) from a seated reservation's assignment and writes the event `tables_split`.
  - Splitting the lead table → `lead_table`.
  - A non-seated reservation → `status_invalid`.
  - Repeating the split → `changed: false`.
- **Pins:** A7's md5 pins of `open_table` and `tables_list` are re-pinned on purpose to the new bodies. Every existing M17–M21 `open_table` and `tables_list` pgTAP case stays green, and the preserves tests (`tests/config/*-preserves.test.ts`, `reservations-preserves.test.ts`) allow exactly this one replacement.
- **Unchanged invariants:** one session on the lead table, bills, covers, the M25c service split and day close.
- **pgTAP `296b_reservation_joined_tables`:**
  - T1+T2 seated on T1 → T2 `joined`;
  - `open_table(T2)` → `table_joined`, by the online path and the `apply_op` path;
  - after the T1 session closes, T2 opens;
  - after a split of T2, T2 opens while T1 is still seated;
  - a waiter can split; the chef gets 42501;
  - a non-member table is unaffected.
- **API and UI (A10, A12, plus the Sala grid):**
  - `POST /api/reservations/[id]/split` for owner, admin and waiter;
  - a joined tile in Sala reads "Unito a Tavolo 1" and is not tappable, and `table_joined` → 409 with an it/en message;
  - "Separa tavoli" on the seated row in `/prenotazioni`.

**Q-R1:** the default stands: owner and admin only accept or decline online requests.

## 6. Risks and mitigations

- **Security and privacy**
  - *Public write abuse:*
    - Defences: the gate, Origin, the honeypot, the signed fill time, the daily HMAC limits, the tenant pending cap and the 4 KB body limit (A3, B1, B7). Staff approve every request anyway.
    - Residual: a distributed bot can still create `pending` noise up to the cap. Mitigation: V3.
    - The read endpoints (`page`, `slots`) are unthrottled. They hold no personal data and cost one cheap RPC. A Vercel firewall rule is a founder option (no price assumed).
  - *Direct PostgREST calls with the public key:* every anon function checks the gate first (B1, B12), and `anon` holds no table privilege (A1, B5).
  - *IDOR and enumeration:* public replies never contain ids. Cancel tokens are MAC-checked before the database, and every invalid case gets the same 404 (B2, B8). Staff reads filter by `app.tenant_id()` (A6).
  - *Personal data exposure:*
    - RLS limits it to owner, admin and waiter; the chef sees 0 rows (A1).
    - None in logs, DETAILs, URLs, outbox rows or Sentry (A3, B7, B10).
    - Reservations are never cached offline (`offline-cache-allowlist` unchanged).
    - E-mails are escaped (B9).
  - *Secrets:* see §3.7. The secret key is used only in the cron route (B5, B10 guards). Keys must be ≥ 32 chars, checked at use (B6). Rotation is in `docs/guides/prenotazioni.md`.
  - *GDPR:* see §3.9. `job_health_checks` watches the retention job (B4). Erasure on request (A5).
  - *CSRF on staff actions:* JSON-only plus SameSite cookies (project plan §3.11.3), unchanged.
- **Correctness**
  - *Overbooking a table:* a per-date advisory lock, the overlap check and a race test (A5).
  - *Slot limits:* a per-service advisory lock and a race test (A3).
  - *DST:* the round-trip check refuses local times that do not exist; CET and CEST are both tested (A3). `starts_at` is stored as `timestamptz`.
  - *Combined tables opened separately in Sala:* allowed by default; each becomes an ordinary bill and no invariant breaks. V4 locks them.
  - *Service schedule changes after a booking:* the booking keeps its stored `service_key`, and the day view lists it under that key.
- **Unverified (proved in the named step)**
  - **T-R1:** the Mailpit bundled with the pinned Supabase CLI accepts `POST /api/v1/send`. mailpit.axllent.org was not reachable from this session. Proved in B9 and B12; if false → V7.
  - **T-R2:** Resend's `POST https://api.resend.com/emails` takes `{from, to, subject, text, html}` and honours `Idempotency-Key`. resend.com was not reachable; the M6 plan cited the idempotency page. `tdd-guide` checks the docs in B9. The live call is a founder step (§8), never CI.
  - **T-R3:** `create extension if not exists pgcrypto with schema extensions` works on the local stack and on Supabase, and `extensions.hmac` matches RFC 4231. Proved in A3 and B1.
  - **T-R4:** whether Vercel overwrites a client-sent `x-forwarded-for` (the open M11 item T4). If not, the IP limit can be spoofed, but the e-mail, phone and tenant caps still hold. Recorded in the PR2 security walk.
  - **T-R5:** Vault secrets can be created inside a pgTAP transaction (`vault.create_secret`) on the local stack. Proved in A3.
  - **T-R6:** `withApi` `{public: true}` works with a custom (anon) client factory. Proved in B7.
- **Performance and cost:** no figure is promised.
  - The public page renders per request, like every page under ADR-028.
  - The mail cron runs every minute only when work is due, like `extract-invoices`.
  - Resend costs: Q-R14, not estimated.
- **Dependencies:** none added (no `resend` package, no CAPTCHA SDK). Only V7 would add `nodemailer` (MIT), and only if T-R1 fails.
- **To record in DigiAlto-Ops `clients/osteria-dei-rossi/context.md` (the lead):**
  - the scope change of 2026-11-08 (PRD lines 21 and 68 lifted for reservations only);
  - ADR-032 proposed;
  - Resend as a new sub-processor;
  - the pending client facts: legal name, VAT, privacy contact, booking hours, venue phone.

## 7. Open questions for the founder

**Lead decisions (2026-11-08):** plan approved; PR1 is built on the defaults.
- **Accepted by the lead:** Q-R3, Q-R4, Q-R7, Q-R8, Q-R9, Q-R10, Q-R11 (30 days, plus deletion on request), Q-R13 (no notes field: allergies are health data, GDPR Art. 9) and Q-R17.
- **Founder answers (2026-11-08):** Q-R1 = default (owner/admin only accept or decline); Q-R5 = Pranzo 12:00–14:00, Cena 19:30–22:00, both online; Q-R6 = V4 plus a split action; Q-R16 = yes, in PR1. See **§5c**.
- **Collected for go-live:** Q-R12, Q-R14 and Q-R15.
- **Q-R16 (now in PR1, §5c):** PR1 adds `reservation.source` (`online` | `staff`, default `online`, immutable), and the contact fields do not assume the public form. Staff entry would reuse `reservation_contact` with the same checks.


Each question has a default in force for this build. A different answer triggers the named variant, a settings change (no code), or a re-plan where stated.

- **Q-R1 May waiters accept and decline?** **Answered 2026-11-08: no (the default).** Default: no, only you and the admin. Waiters see bookings, mark arrived or no-show, and open tables. Alternative → V1.
- **Q-R2 Should the chef see bookings?** Default: no access. Alternative: covers per service without names → V2.
- **Q-R3 Address of the booking page.** Default: `<app domain>/prenota/<slug>`, where you choose the slug in the settings (e.g. the restaurant's name). Alternative: a booking domain of its own (e.g. `prenota.<your domain>`) → V5 (needs Q-R15).
- **Q-R4 Capacity defaults.** Default:
  - 15-minute slots, and a table is held for 120 minutes;
  - requests at least 2 hours ahead and at most 60 days ahead;
  - up to 8 people online (larger groups: "call us");
  - no closed days, and no per-slot or per-service limits.

  All of these are settings you can change without code.
- **Q-R5 Booking hours per service.** **Answered 2026-11-08: Pranzo 12:00–14:00, Cena 19:30–22:00, both online; seeded as defaults (§5c).** No default, because your opening hours are not an approved fact. Which times can customers pick for Pranzo and for Cena, and is any service not bookable online? The page cannot be switched on until these are set.
- **Q-R6 Combining tables.** **Answered 2026-11-08: V4, block the joined tables, plus a split action (§5c).** Lock time limit decided 2026-11-08 (lead): none; the lock lasts while the lead session is open; split or close T1 to release; the tile shows '(oltre l'orario)' after ends_at. Default:
  - the waiter opens the first table of the group for the whole party (one bill);
  - the other tables show "unito a…" in Prenotazioni but are not blocked in Sala;
  - a table already held by another overlapping booking cannot be assigned;
  - accepting without a table is allowed.

  Alternative: block the joined tables in Sala → V4.
- **Q-R7 Spam protection.** Default:
  - a hidden field and a minimum fill time;
  - per day: at most 5 requests per connection, 3 per e-mail and 3 per phone;
  - at most 100 unanswered requests at once;
  - no CAPTCHA (no third-party script).

  Alternative: Cloudflare Turnstile or similar → V3. That is a new provider whose terms and prices you would check.
- **Q-R8 Customer cancellation.** Default: the link works until the booked time. You get no e-mail; the booking shows "Annullata dal cliente". A cut-off (e.g. 2 hours before) is a setting.
- **Q-R9 Staff changes.** Default: moving a booking sends no e-mail; you call the customer (the phone number is there). Declining an already accepted booking sends the "declined" e-mail. Alternative: an e-mail on every move → V6.
- **Q-R10 Telling staff about new requests.** Default: a count on Prenotazioni, refreshed every minute while the page is open; no push or e-mail. Alternative: an alert or e-mail to you → a re-plan (a new alert kind).
- **Q-R11 How long we keep customer data.** Default:
  - name, phone and e-mail are deleted 30 days after the booked date, for declined and cancelled requests too;
  - you can delete them on request at any time;
  - the anonymous record (date, time, party, outcome, tables) is kept for statistics.

  The 30 days are a setting. Alternative: delete the anonymous record too → a re-plan of the retention job.
- **Q-R12 Privacy notice.**
  - Needed from the client: the legal name, VAT number and a privacy contact e-mail. These are not yet approved facts; `docs/client-facts.md` gets placeholders marked pending.
  - The client (or their advisor) must approve the notice text that DigiAlto drafts.
  - Default: the checkbox reads "Ho letto l'informativa privacy". It is an acknowledgment, not consent, because the basis is the customer's own request (Art. 6(1)(b)).
- **Q-R13 A notes field (allergies, high chair, occasion).** Default: none, because allergies are health data that need explicit consent and stricter handling. Alternative: a re-plan.
- **Q-R14 Resend.**
  - Who opens and owns the account: DigiAlto or the client?
  - Its prices and fees (not estimated here).
  - Where it stores data, and how long it keeps e-mail content and logs.
  - The DPA.
  - The sender address (e.g. `prenotazioni@<domain>`).
- **Q-R15 Domains (go-live).**
  - The custom domain for the app: staging is behind Vercel's login, so customers cannot reach it.
  - The domain Resend sends from, with the DNS records to verify it.

  Until both exist, the page is reachable only on staging and preview.
- **Q-R16 Phone bookings typed by staff.** **Answered 2026-11-08: yes, in PR1; owner, admin and waiter create bookings that go straight to accepted (§5c).** Default: not in this feature; staff note them as today. Alternative: a staff "Nuova prenotazione" form → a re-plan. That is staff-entered personal data, with no customer notice at the moment of collection.
- **Q-R17 Venue phone for "call us".** Default: you type it in the settings. Until then, large groups see "contattaci direttamente" without a number. Please confirm.

## 8. Manual steps for the founder

- **Before PR1 merges:** none. The migrations reach staging through the existing deploy job. Nothing is public, because the settings default to `enabled: false`.
- **Before PR2 is useful on staging:**
  - set the Vercel env `RESERVATION_GATE_KEY` and `RESERVATION_LINK_KEY` (each `openssl rand -hex 32`), plus `MAIL_TRANSPORT`, `MAIL_FROM` and `APP_PUBLIC_ORIGIN`;
  - create Vault `reservation_gate_key` (the same value as the env) and `reservation_hash_salt` (see `docs/guides/cron-vault-secrets.md`).

  Without them the public routes answer 503 and nothing else breaks.
- **Before real customers (the feature's go-live):**
  1. answer Q-R5, Q-R12, Q-R14 and Q-R15; the client approves the notice text;
  2. put the DPA between the client and DigiAlto, and Resend's DPA, in place;
  3. add the §3.9 entry to the controller's records of processing;
  4. open the Resend account with MFA, verify the domain, put `RESEND_API_KEY` in Vercel (production only) and set `MAIL_TRANSPORT=resend`;
  5. add the custom domain on Vercel, then delete Vault `vercel_protection_bypass` (existing guide) and update `app_base_url`;
  6. the owner fills in the settings and switches the page on;
  7. link the page from the website, Google and Instagram.
- **After go-live:** DigiAlto checks one real request end to end on production: received → accepted e-mail → cancel link.

## 9. Sources

- Worktree `/home/user/osteria-resv`:
  - `CLAUDE.md`; `docs/prd.md` lines 21 and 68; `docs/plans/2026-10-21-project-plan.md` §3.6, §3.9, §3.11, §5a;
  - `docs/plans/2026-11-01-m25c-services.md`; `docs/adr/adr-031-service-periods.md`; `docs/client-facts.md`; `docs/guides/cron-vault-secrets.md`.
- Migrations:
  - `20261031100000` (tables, sessions, guards, RLS) and `20261031100500` (`open_table`);
  - `20261022120200` and `20261122100000` (`call_cron_route`);
  - `20261025100000` and `…100200` (`app.enrol_failure`);
  - `20261112100000` (`job_run_job_check`);
  - `20261120100100` (purge list).
- Code:
  - `src/proxy.ts`, `src/lib/supabase/proxy.ts`, `src/lib/security-headers.ts`, `next.config.ts`, `src/lib/env/index.ts`;
  - `src/server/cron/with-cron.ts`, `src/app/api/cron/extract/route.ts`;
  - `src/server/tables/{list,open}.ts`, `src/server/staff-auth/{enrolment,tokens}.ts`;
  - `src/app/(public)/layout.tsx`, `src/lib/i18n/locale.ts`;
  - `e2e/helpers/{mailbox,session}.ts`, `.env.example`, `supabase/config.toml`.
- `/home/user/osteria-m25/docs/adr/adr-028-nonce-csp-in-proxy.md`; `/home/user/osteria-m25/docs/plans/2026-11-01-m25-go-live.md` (numbering, §8).
- DigiAlto-Ops `knowledge/clients/osteria-dei-rossi/profile.md`, lines 17, 21, 75, 80 and 87–93: the legal name, VAT, domains and Resend are all unverified or missing.
- Web:
  - Resend idempotency keys, <https://resend.com/docs/dashboard/emails/idempotency-keys>, as cited by the M6 plan. Not re-read: resend.com and mailpit.axllent.org were not reachable from this session, hence T-R1 and T-R2.
  - GDPR Art. 6(1)(b), 6(1)(f), 9, 13 and 17: Regulation (EU) 2016/679.
