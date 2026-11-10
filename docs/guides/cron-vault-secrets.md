# Cron: Vault secrets for pg_cron and pg_net

Supabase Cron calls the app's `/api/cron/*` routes through `app.call_cron_route` (pg_net). It reads
three secrets from Supabase Vault, per Supabase project. Until `app_base_url` and `cron_secret` both
exist the function only raises a notice and calls nothing, so local stacks and CI never call out.

| Vault name | Value comes from | Needed |
|---|---|---|
| `app_base_url` | The deployment URL, for example `https://<app host>` (a trailing slash is dropped). | Always |
| `cron_secret` | The same value as the app's `CRON_SECRET` environment variable in Vercel. | Always |
| `vercel_protection_bypass` | Vercel > Settings > Deployment Protection > Protection Bypass for Automation. | Only while the URL is a protected `*.vercel.app` domain |

Without the third secret the request is stopped by Vercel's login wall before the route's bearer check
runs. When it is set and not blank, the call adds the header `x-vercel-protection-bypass`. On a custom
domain leave it out: the headers are then `Authorization` and `Content-Type` only. The value is never
logged or returned. It is sent to whatever `app_base_url` points at, so when the app moves off `*.vercel.app` to a
custom domain, delete the secret (`delete from vault.secrets where name = 'vercel_protection_bypass';`).

## Set them (SQL editor or `psql`, placeholders only)

```sql
select vault.create_secret('<deployment URL>', 'app_base_url');
select vault.create_secret('<same value as CRON_SECRET in Vercel>', 'cron_secret');
select vault.create_secret('<Protection Bypass for Automation secret>', 'vercel_protection_bypass');
```

`vault.create_secret` fails on a name that already exists. To change a value, update it with
`select vault.update_secret(id, '<new value>') from vault.secrets where name = '<name>';`, or delete the
row from `vault.secrets` and create it again. Never commit real values; they live only in Vault and Vercel.

## Reservations (public booking page)

The public booking page signs every call to the database with a key that only the app and Vault hold (ADR-032). Three more Vault secrets belong to it, per Supabase project.
Without `reservation_gate_key` or `reservation_hash_salt` the public routes answer 503 `reservations_unconfigured`: the failure is visible, never silent.

| Vault name | Value comes from | Needed |
|---|---|---|
| `reservation_gate_key` | The same value as `RESERVATION_GATE_KEY` in Vercel (at least 32 characters, for example `openssl rand -hex 32`). The database checks the signature the routes make with it. | Always, once the page is used |
| `reservation_gate_key_next` | The new gate key, only while rotating it (see `docs/guides/prenotazioni.md`). The database accepts a signature made with either key. | Only while rotating; delete it afterwards |
| `reservation_hash_salt` | A random value of your own (`openssl rand -hex 32`). It salts the daily hashes of IP, e-mail and phone that limit abuse. Vault only, never in the environment and never in Vercel. | Always, once the page is used |

```sql
select vault.create_secret('<same value as RESERVATION_GATE_KEY in Vercel>', 'reservation_gate_key');
select vault.create_secret('<random value, Vault only>', 'reservation_hash_salt');
-- only while rotating the gate key:
select vault.create_secret('<new gate key>', 'reservation_gate_key_next');
```

Change a value with `vault.update_secret` as above; changing the salt at any time only resets the day's counters. The local stack and CI get fake values from `supabase/seed.sql`
(equal to the fakes in `.env.example` and in `.github/workflows/ci.yml`). The mail route needs nothing more in Vault: pg_cron reaches it through `app_base_url` and `cron_secret`, as
`/api/cron/extract` does.
