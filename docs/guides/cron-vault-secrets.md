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
