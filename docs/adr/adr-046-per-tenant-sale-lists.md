# ADR-046 — Per-tenant sale lists: two VAT lists, per-tenant receipt and payment codes, and a locale

- **Status:** accepted (the founder may revisit; see "What would make us revisit this")
- **Date:** 2026-11-18 · **Decided by:** lead (plan approval and lead decisions 2026-11-18); the two-list VAT design is the founder's (platform plan §0a)
- **Plan:** `docs/plans/2026-11-15-sp01-tenant-config.md` (§3.1 to §3.3; Q1, Q11, Q12; steps 3 to 7, 13). Migrations `20261206200000` to `20261206200400`.
- **Number:** 046 is the next free number on main (045 is the newest in `docs/adr/`, checked 2026-11-18).
- **Supersedes nothing.** It builds on ADR-002 and ADR-003 (every table has `tenant_id` and RLS, roles are enforced in Postgres) and ADR-018 (demo purge).

## Context
- Until SP1 the sale VAT rates (0, 4, 5, 10, 22), the receipt types (`scontrino`, `fattura`), the payment types (`cash`, `card`, `other`)
  and the Europe/Rome zone and Italian language were the same constants for every venue, in SQL and in the browser.
- A second venue must be able to sell at fewer rates (a venue at 10 % and 22 % must not be offered 4 %), offer fewer document types, and
  have a language of its own, without a deploy and without touching tenant #1's behaviour.
- The statutory list also checks supplier invoices (`app.line_checks`), and a rate on a supplier invoice is the supplier's, not the venue's choice.
- A CHECK constraint can not read another table (pgTAP 396 pins that no CHECK depends on a non-immutable function).

## Decision
1. **Two VAT lists.**
   - The **statutory list** stays `app.allowed_vat_rates()` (immutable, 0, 4, 5, 10, 22). It checks supplier invoices and bounds the three sale-side CHECKs.
   - The tenant's **sale list** is `public.tenant_vat_rate`, a subset of the statutory one, read through `app.sale_vat_rates(tenant)` (stable). Every tenant is seeded with all five and every existing tenant is backfilled, so tenant #1 sees no change (pgTAP 389 pins its payloads).
2. **The sale list is enforced by a trigger, not a CHECK.** `app.check_sale_vat_rate()` on `menu_item_price` and `sale_settings` raises `P0001 vat_rate_invalid` for a statutory rate that the tenant does not sell at. A rate outside the statute still meets the column CHECK (23514, as before). The trigger reads `new.tenant_id`, so it holds for every writer.
3. **Only a new or changed rate is checked.** A rate that left the list after it was stored keeps working until it is changed, and is never silently changed (Q12). `table_session.coperto_vat_rate` stays a snapshot with the statutory CHECK only, so an open session keeps its rate.
4. **Receipt and payment codes per tenant.** `public.tenant_close_code (tenant_id, kind, code, position, is_active)` holds which codes of the catalogue a tenant offers and in what order. The catalogue (the codes the product has labels for and the `table_session` CHECKs allow) is unchanged. `close_table` refuses a code the tenant does not offer (`receipt_type_invalid`, `payment_type_invalid`) before any write; the day report lists the tenant's active codes and still shows a deactivated code used that day.
5. **Locale.** `tenant.default_locale` (`it` or `en`, CHECK equal to `LOCALES`). The browser reads it from `GET /api/me` (`settings`); the first paint stays `it`. Time zone and currency are read, not editable (Q2).
6. **One write path.** `public.set_tenant_settings(jsonb)` (owner or admin, one transaction, strict keys `locale`, `saleVatRates`, `receiptTypes`, `paymentTypes`) behind `PATCH /api/settings/venue`. Rows are never deleted: a removed value becomes `is_active = false`. An identical call changes nothing and writes no audit row. One `tenant.settings_changed` audit row per change, with codes and numbers only.
7. **Reads never hide a cost.** `tenant_settings()` (every role) carries no VAT key; the sale list reaches only the owner and admin forms and the PATCH answer.
8. **Configuration is not operational data.** Both new tables are exempt from the demo purge (ADR-018): a purge keeps them.

## Alternatives
- **A1. One list (replace the statutory list).** Rejected: supplier invoices would then be checked against what the venue sells at.
- **A2. A CHECK that reads the tenant table.** Rejected: not allowed by Postgres for subqueries, and a function-based CHECK would be non-immutable (pgTAP 396).
- **A3. Refuse removing a rate that current prices use.** Rejected (Q12): it would block a venue from fixing its list. Existing prices stay valid until edited.
- **A4. Store the lists as JSON on `tenant`.** Rejected: no key per value, no per-value audit of who changed it, no `position`.
- **A5. Per-tenant manifest `lang` and a per-tenant first-paint language.** Rejected for SP1 (Q5): the manifest is the product's, served before sign-in.

## Consequences
- Good: a venue chooses its VAT rates, documents, payment methods and language by one audited call; tenant #1 and every existing tenant behave as before; the rule holds for every writer, including the demo seed.
- Bad / accepted trade-offs: two VAT lists to keep in mind (statute for invoices, sale list for the menu); a rate removed from the list can still be on stored prices and open sessions until someone changes them; there is no screen in SP1, only the route (SP7's wizard and a later screen use it).
- What would make us revisit this: the founder prefers one list, or wants a rate removal refused while prices use it (plan variant V5), or a venue needs a code that the catalogue does not have.
