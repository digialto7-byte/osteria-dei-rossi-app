# Tech plan: Costì · Local producers network ("Rete produttori locali")

- **Client slug / internal:** internal DigiAlto product planning for **Costì** (FD27). `osteria-dei-rossi` is tenant #1 and the pilot
  venue. English document; the UI strings it names are Italian.
- **Repo and branch:** `osteria-dei-rossi-app`, worktree `/home/user/osteria-producers`, branch `docs/local-producers-plan`. Documents
  only, no code.
- **Author:** architect · **Date:** 2026-11-14
- **Status:** proposal for a **future** feature. Planning only. It is built **after go-live (2027-01-12), after the two-week supervised
  run (Gate 4), and after the SaaS platform milestones it depends on (§1.4)**, at the founder's order. No date, price, fee, volume or
  performance figure is promised or estimated here.
- **ADR:** none written yet. The decision "producers are a party outside tenants" (§2) outlives this task, so LP0 writes it as an ADR
  with the **next free number at that time** (ADR numbers are being taken on other branches; guessing one here could collide). Until then
  this plan is the record.
- **Inputs read:** `CLAUDE.md`; `docs/plans/2026-11-13-platform-saas.md` (§0, §0a, §0b, §1–§4, §6, §7, §9, §10 milestone table, §10a SP3
  and SP7, §11); ADR-037, ADR-038, ADR-039, ADR-040; `docs/plans/2026-11-11-phase2-scope.md` (C3, C7, C12, C19, Part 3 rows P2-2 and
  P2-7); `docs/client-facts.md`; migrations `20261021120000_tenancy_baseline.sql`, `20261021130100_location_ingredient.sql`,
  `20261021130200_supplier.sql`, `20261022100000_invoice.sql`, `20261022120000_invoice_extraction.sql`, `20261022140100_stock_ledger.sql`,
  `20261023100200_recipe_tables.sql`, `20261028100000_batch_tables.sql`, `20261031100000_menu_tables_core.sql`, `20261106100300_void_line.sql`
  (lines cited where used); `.claude/skills/engineering-standards/SKILL.md`, `.claude/skills/security-checklist/SKILL.md`; DigiAlto-Ops
  `knowledge/agency/products/costi/brand.md` and `templates/tech-plan.md`. Web research on 2026-11-14 (§10).
- **Client facts used:** the trading name "Osteria Dei Rossi" and its approved registered address in Siena (SI) (`docs/client-facts.md`
  lines 12 and 20), only to name the pilot venue and its province. No other client fact. Tenant #1's **draft** menu is mentioned once in
  §8 as an internal observation, marked as draft; it is not a fact.
- **No e-mail address appears in this plan.** The platform admin account is "the platform admin account (address held by DigiAlto)"
  (FD28).
- **ID scheme:** milestones **LP0–LP6**; network defaults **ND1–ND13** (§9.1); variants **V1–V6** (§7b; these are this plan's own IDs,
  not the platform plan's V1–V16); assumptions **A1–A8** (§1.6); questions **Q-F, Q-L, Q-P** (§9.2). Platform IDs (SP*, FD*, T*) keep the
  meaning they have in the platform plan.
- **How this file maps to `templates/tech-plan.md`:** §0 = founder summary; §1 = goal, scope, prerequisites and current state; §2–§5 =
  design; §6 = alternatives; §7 = build plan (milestones with acceptance tests) and §7b = variants; §8 = risks (with secrets);
  §9 = defaults and open questions; §10 = sources.

---

## 0. Summary for the founder (plain language)

**The idea, as I understood it.** Local producers of food and drink (an allevamento of Cinta Senese pigs, a Chianti Classico winery, a
caseificio, an olive mill) get a place inside Costì: a short profile, a catalogue and **offers reserved to Costì venues**. Venue owners
open **"Rete produttori"**, look for new fornitori by **province, category and designation** (DOP, IGP, DOCG ...), and ask for contact
in one tap. Costì can also **suggest** producers that fit what the venue already buys and cooks. And because Costì already follows each
ingredient from the supplier's invoice to the plate, it can tell the owner, **truthfully**, when a dish can say "Cinta Senese DOP from
producer X".

**What the first version is, and is not.**
- It is a **directory with contact requests**, not a marketplace: no orders, no payments and no commission go through Costì (ND2).
  The producer and the venue agree price and delivery between themselves, as today.
- **Producers are not venues.** They get their own kind of login, separate from every venue's account. **A producer never sees any
  venue's invoices, prices paid, costs, volumes, menu or staff.** The only thing a producer receives is the contact request the owner
  writes and sends, shown to the owner in a preview first (ND4). The owner can withdraw it.
- **Producers join by invitation**, like venues (your FD5): DigiAlto invites them, for example producers that owners point out to us.
  A public application form is possible later (V1).
- **Suggestions stay inside each venue.** They are computed from that venue's own ingredients, recipes and chosen provinces, and from
  the producers' public catalogue. Nothing is pooled across venues. Pooling ("what restaurants near you buy") would use one venue's
  data for another's benefit: it needs the legal adviser, a change to the DPA and each owner's opt-in, so it is only a variant (V4).

**Designations: what I verified.** From the EU's official texts (found through search on 2026-11-14; §4.1 gives the exact sources and
the limits of what I could open):
- **"Cinta Senese" is a registered DOP** (EU "protected designation of origin"), for **fresh meat**, registered in 2012, with its
  specification amended in 2020.
- **"Chianti Classico" is a registered wine DOP** (EU file PDO-IT-A1235); on the Italian label it is a **DOCG**, which Italian wine law
  uses as a traditional term for DOP wines.
- The MASAF list of **PAT** (prodotti agroalimentari tradizionali) is a census: being on it does **not** protect the name. Costì will
  never show a PAT as if it were a DOP or IGP.

**How a dish claim stays true.** Costì writes "Cinta Senese DOP — Produttore X" next to a dish only when **both** hold: DigiAlto has
checked the producer's certificate from its control body (not just the producer's word), **and** the venue's own lot trace shows that
every portion now on hand came from that producer's certified lots. If one lot is missing a code, or came from another supplier, Costì
shows the gap instead of the sentence, and alerts the owner when a dish that claims it stops qualifying. The owner still decides what the
menu says; Costì does not publish menus.

**When and how big.** After go-live and after these SaaS milestones: SP0, SP2, SP3, SP5, SP6, SP7 and SP10 (§1.4 says why each), plus
Phase 2 step P2-2 (lot trace). P2-7 (XML e-invoices) is not required but makes the matching exact. **Seven milestones, LP0–LP6: three
small, four medium, none large.** No dates.

**What I need.** One question each for you, the legal adviser and the producers (§9.2). Everything else takes the recommended default
in §9.1, which you may revisit. For you: is the network mainly a **service that makes Costì more valuable to venues** (free for
producers, as I recommend for a pilot around Siena), or **a revenue line from producers**?

---

## 1. Goal, scope, prerequisites and current state

### 1.1 Goal
Let invited local producers keep a profile, a catalogue, designation claims and Costì-venue-only offers in Costì, outside every tenant;
let venue owners discover them, contact them and get privacy-preserving suggestions; and let a dish show a protected designation and its
producer only when a checked certificate and the venue's own lot trace agree.

### 1.2 In scope
Producers as a new party type outside tenants (identity, session mode, invitation, terms, suspension); producer profile, catalogue,
offers and designation claims with evidence; a designation catalogue seeded from official registers; DigiAlto verification in the
console; owner-side search, detail, venue-only offers and contact requests; linking a venue's existing suppliers and supplier items to
network producers and products; the dish designation check on top of P2-2's trace; rule-based suggestions computed inside the tenant;
commercial options and the questions they raise (options only); milestones, tests, risks.

### 1.3 Out of scope
Orders, purchase orders, payments, invoicing between producers and venues, commission (all ND2; V3 is the commission option); public
producer pages or a public directory; publishing designations on any public menu (no public menu exists: platform FD20 default, its V12);
maps, distance or geocoding; in-app chat between producer and venue; producer photos and logos (text only in the base plan); bars and
coffee shops until platform SP8 (FD14); countries other than Italy (FD19); any price, fee, tier name or legal text (founder, FD3; legal
adviser, FD22); any change to the SDI intake beyond what P2-7 plans. Paths that depend on an open answer are only in §7b.

### 1.4 Prerequisites (platform SP milestones and Phase 2 steps)

| Prerequisite | Needed by | Why |
|---|---|---|
| **SP0** spike (T1 `session_id` in the hook on every method; T2 hosted stack accepts a custom Postgres `role` claim) | LP0, LP1 | The producer session is a third session mode built like console mode (ADR-037): a custom role claim with no table grants. If T2 fails, V5 applies |
| **SP2** memberships (session-mode selection in the hook, `app.session_tenant`, `(tenant_id, auth_id)` uniqueness) | LP1 | The hook gains a producer branch next to the tenant and console branches; it must be added to SP2's hook, not to today's single-membership hook, and re-pinned once |
| **SP3** platform layer (schema `platform`, `platform_staff` role, console host, platform audit, metadata whitelist test, `scripts/` audit helper) | LP1, LP2 | DigiAlto invites, suspends and verifies producers from the console; every such action writes a platform audit row; the whitelist test pattern is reused for every producer- and tenant-facing network function |
| **SP5** entitlements (`platform.feature`, `app.require_feature`, `withApi({feature})`, catalogue test for tenant-linked tables outside `public`) | LP3, LP4, LP6 | The owner side is the module `producer_network`, switched on per plan or override; `network.contact_request` carries `tenant_id` outside `public` and must be in SP5's catalogue test |
| **SP6** tenant status and write gate (`app.require_writable()`) | LP3, LP4 | A suspended or cancelled venue must not send contact requests or create links |
| **SP7** invitation provisioning (`scripts/tenant-invite.ts`, `bind_tenant_invitation`, `redeem_*`, `terms_acceptance`, sign-up closed) | LP1 | Producer invitations copy the pattern: the login is created by a script with the secret key in `scripts/` only, Supabase Auth sign-up stays off (FD5) |
| **SP10** export and erasure (`platform.erase_tenant`) | LP3 | Contact requests are copies of venue data held in schema `network`; a venue's erasure must remove them, and the venue's export must include them |
| **P2-2** trace and sell-through (C3: forward/backward lot trace) | LP5 | The dish check reads P2-2's trace (lot → batch → order line and back); it adds no trace logic of its own |
| P2-7 XML e-invoice upload (C19) | — (optional, improves LP4 and LP5) | Exact supplier VAT and line codes make supplier↔producer and item↔product links exact; lot codes are read from `invoice_line.lot_code` whatever the source |

**Not prerequisites:** SP1 (configuration), SP4 (DigiAlto's admin membership: the network does not depend on it; DigiAlto's actions in a
tenant stay recorded as SP4 designs), SP8, SP9, SP11, SP12, SP13. Tenant #1 gets `producer_network` through a feature override (ADR-039),
whether or not SP13 has moved it to `enforce`.

### 1.5 Current state (files)

| Area | State today | Consequence |
|---|---|---|
| Suppliers | `public.supplier` (name, optional IT VAT, unique per tenant on `(tenant_id, vat_number)`), `public.supplier_item` (supplier code or description hash, pack, `last_price`; owner/admin only because it is a cost table) (`20261021130200_supplier.sql` lines 5–55, policies 100–120) | A venue's suppliers are tenant data; a producer is linked to a supplier by an exact VAT match the owner confirms (LP4); the producer never reads these tables |
| Invoices | `public.invoice` (owner/admin only, files `<tenant>/<yyyy>/<id>.(pdf|jpg|png)`, max 4 MiB, `20261022100000_invoice.sql` lines 18–54); `public.invoice_line` with `supplier_code`, `lot_code`, `expiry` (`20261022120000_invoice_extraction.sql` lines 43–78), mapped to `supplier_item_id` at review (`20261022130400_review_update_line.sql` lines 245–298) | The line's supplier item and lot code are the bridge from a delivery to a producer's product |
| Lots | `public.raw_lot`: one lot per received invoice line, with `supplier_id`, `invoice_line_id`, `lot_code` (optional), `received_on` (`20261022140100_stock_ledger.sql` lines 14–43) | A lot knows its supplier and the invoice line; the designation check uses `received_on` against the certificate's validity |
| Batches | `public.batch_input` links a batch to the lot slices it consumed, `raw_lot_id null` for the unlotted shortfall ("The forward and backward trace of M31 reads these", `20261028100000_batch_tables.sql` lines 61–90) | A missing lot is a visible gap, never guessed |
| Sales | portion depletion `batch_movement` `consume` with `ref_type = 'order_line'`; direct raw consumption `stock_movement` `consumption` with `ref_type = 'order_line'` (`20261106100300_void_line.sql` lines 99, 103) | The check covers both paths through P2-2's trace |
| Ingredients, recipes, menu | `ingredient.category` free text (`20261021130100_location_ingredient.sql` line 24); versioned recipes with sub-recipes (`20261023100200_recipe_tables.sql` lines 43–96); `menu_item.recipe_key` (`20261031100000_menu_tables_core.sql` lines 19–44) | Inputs for rule-based suggestions (LP6) and for the dish check (LP5) |
| Tenant | `tenant.name`, no address or coordinates (`20261021120000_tenancy_baseline.sql` lines 13–23) | Area is a province list the owner chooses (ND9), not a distance |
| Platform | SP3's console, `platform_staff`, platform audit; ADR-037 limits "every table has `tenant_id` and RLS" to tenant data and lists non-tenant tables by name | The `network` schema follows the same rule (§2.6) |
| Brand | Costì brand: traceability and lot tracking are "Phase 2, not built yet. Do not use them in client-facing or sales material until they ship" (DigiAlto-Ops `knowledge/agency/products/costi/brand.md` lines 63–65) | The network and the dish check are not marketed until they ship (§8) |

### 1.6 Assumptions (not facts; each is checked where named)
- **A1.** Producers that join are Italian VAT-registered businesses; `app.is_valid_it_vat` (used by `supplier.vat_number`) validates their
  VAT. Checked in LP1 test 5.
- **A2.** A producer can obtain a document from its control body or consorzio showing that a named product is certified, with a validity
  date. Asked to producers (Q-P, §9.2).
- **A3.** No public, machine-readable list of certified operators per designation was found (the Cinta Senese search found news and the
  consorzio's history, not a register of operators; the Italian control-structure register on SIAN lists control bodies, not operators,
  §10 S11). Verification is therefore a human check by DigiAlto (§4.3). LP0 test 4 looks again.
- **A4.** eAmbrosia offers no export or API that this plan relies on (not checked). DigiAlto seeds designations by migration (§4.2). LP0
  test 4 records what the register offers.
- **A5.** Some small agricultural producers may not issue the invoice themselves (not researched). Where a delivery has no supplier
  invoice in Costì there is no `raw_lot`, and the trace shows a gap; nothing is inferred.
- **A6.** Lot codes on invoices are optional today; their capture is P2-2's concern (C3 risks). The dish check reports what is missing.
- **A7.** The ISTAT list of provinces can be reused as seed data; its licence is read in LP0 (test 5).
- **A8.** Whether the platform-to-business and marketplace rules apply to a B2B directory is **not** stated here; secondary sources
  suggest they target services that reach consumers (§5.2). For the adviser (Q-L).

---

## 2. Producers: a new party type outside tenants

### 2.1 The model in one paragraph
A **producer** is a business (`network.producer`) with one or more **producer members** (`network.producer_member`: auth users). A
producer is not a tenant: it has no ledgers, no `app_user` row, no tenant claim and no row in any `public` tenant table. Its data
(profile, catalogue, offers, designation claims, evidence) lives in a new schema **`network`**, not exposed by the Data API, read and
written only through definer functions: `public.producer_*` for producer sessions, `public.network_*` for tenant sessions,
`public.platform_network_*` for DigiAlto's console. Venues see producers' **published** data; producers see **nothing** of venues except
the contact requests owners send them (§2.4).

### 2.2 How producers join (invitation; ND1)
FD5 keeps venues invitation-only and Supabase Auth sign-up off (`supabase/config.toml` `enable_signup = false`, go-live item M-5). The
same rule applies to producers by default:

1. **DigiAlto creates the producer (console, no secret key).** The platform admin, in console mode at `aal2`, calls
   `public.platform_network_create_producer(p_legal_name, p_vat, p_display_name, p_contact_email)` → `network.producer` row with status
   event `invited`, one `network.producer_invitation (id, producer_id, email, auth_id null, expires_at, redeemed_at, created_by_staff)`, one
   platform audit row (`network.producer_created`, ids only). Leads come from DigiAlto's own scouting and from owners who tell DigiAlto
   about a supplier (outside the app in the base plan).
2. **The login (script, secret key in `scripts/` only).** `scripts/producer-invite.ts --invitation <id>` creates the confirmed auth user
   for the invitation's address or reuses an existing producer login, binds it through the service-role-only
   `public.bind_producer_invitation(p_invitation, p_auth_id)`, and writes one platform audit row. It refuses an address that belongs to an
   auth user with any `app_user` row (ND7) and the platform admin account.
3. **First sign-in and redeem.** The producer signs in with the existing e-mail code; `/produttore/benvenuto` shows the producer terms
   (text by the legal adviser; key `producer_terms`); `public.redeem_producer_invitation(p_invitation)` checks binding, expiry and single
   use, then writes the `network.producer_member` row, the `network.terms_acceptance` row and the status event `active` in one
   transaction.

A public application form is **V1** (trigger: the founder revisits ND1).

### 2.3 Profile, catalogue and offers (data model)

All tables below are in schema `network`, RLS on, **no grant** to `anon`, `authenticated`, `network_producer` or `platform_staff`; every
read and write goes through the definers named in §2.5. Append-only where marked (UPDATE/DELETE refused by the existing append-only
trigger pattern), so "who claimed what, when" is never lost.

| Table | Shape (main columns) | Notes |
|---|---|---|
| `producer` | `id`, `legal_name`, `vat_number` (IT check), `created_at`, `created_by_staff` | identity only; display data is versioned |
| `producer_status_event` (append-only) | `producer_id`, `status` (`invited`, `active`, `suspended`, `withdrawn`), `reason_code`, `effective_at`, `created_by_staff`/`created_by_member` | current status derived (newest effective row), as `tenant_status_event` (ADR-039) |
| `producer_member` | `producer_id`, `auth_id` (unique), `display_name`, `is_active`, `created_at` | one login belongs to one producer; triggers enforce ND7 |
| `producer_invitation` | as §2.2 | single use, expiring |
| `terms_acceptance` (append-only) | `producer_id`, `member_id`, `document_key`, `version`, `at` | mirrors SP7's `public.terms_acceptance` for producers |
| `producer_profile_version` (append-only) | `producer_id`, `display_name`, `description` (plain text, length-capped), `province_code`, `comune` (text), `categories text[]` (fixed list), `published_contacts jsonb` (only the channels the producer chooses to publish: business phone, business e-mail, website URL), `valid_from`, `created_by_member` | the newest version is the profile; venues see only these fields |
| `product` + `product_version` (append-only versions) | `producer_id`, `name`, `category` (fixed list), `unit` (text: "kg", "bottiglia 0,75 l" ...), `producer_code` (optional; the code the producer prints on its invoices), `season_months smallint[]`, `description`, `is_active` | `producer_code` lets LP4 propose item↔product links from `invoice_line.supplier_code` |
| `offer_version` (append-only) | `offer_id`, `producer_id`, `product_id null`, `title`, `terms` (plain text written by the producer: the reserved condition), `valid_from`, `valid_to`, `audience` (`costi_venues` only), `is_withdrawn`, `created_by_member` | the newest version is the offer; withdrawing is a new version; **visible only to entitled tenant sessions** (owner, admin), never public; Costì neither sets nor guarantees the terms |
| `designation` | `id`, `name`, `kind` (`pdo`, `pgi`, `tsg`, `wine_pdo`, `wine_pgi`, `spirit_gi`, `pat`), `label_it` ("DOP", "IGP", "STG", "DOCG", "DOC", "PAT" ...), `product_class`, `register_ref` (e.g. the eAmbrosia file number), `source_url`, `is_protected_name boolean`, `checked_on`, `checked_by_staff` | **seeded by migration by DigiAlto only** (§4.2); producers pick from it |
| `designation_claim` + `designation_claim_event` (append-only) | claim: `product_id`, `designation_id`, `created_by_member`; events: `declared`, `evidence_added`, `verified (valid_until)`, `rejected (reason_code)`, `revoked`, with actor | status derived; `expired` = `verified` with `valid_until` before the date asked (§4.3) |
| `contact_request` + `contact_request_event` (append-only) | request: `id`, `producer_id`, **`tenant_id`**, `payload jsonb` (whitelisted, §2.4), `sent_by` (the owner's `app_user` id), `created_at`; events: `sent`, `read`, `answered`, `withdrawn` | built in LP3; the only tenant-linked data in `network`: RLS on, non-null `tenant_id`, listed in SP5's catalogue test, erased by SP10's `erase_tenant` (LP3 test 7) |

Storage: a private bucket **`producer-evidence`**, path `<producer_id>/<claim_id>.<ext>`, PDF/JPEG/PNG up to the invoice limit (4 MiB,
`invoice_file_size_ck`), written by the producer's own members, read by them and by the console; no tenant access.

Fixed lists (`categories`, `province_code`) are seeded tables (`network.category`, `network.province`); the province list comes from
ISTAT's published codes (A7).

### 2.4 What a producer can never see, and what an owner can share

**Never visible to a producer** (no grant, no function returns it): any `public` tenant table; invoices and their lines; prices paid;
`supplier_item.last_price`; costs and margins; stock, batches and sales volumes; menus and recipes; staff; reservations; which venues
searched for, viewed or were suggested the producer (no search log, no view count, no impression: ND10); whether a venue linked the
producer to one of its suppliers (LP4 test 3); any tenant id.

**What an owner can share, only by pressing "Invia richiesta" after a preview** (ND4; `public.network_send_request`, owner only):

| Field | Source | Required |
|---|---|---|
| `venue_name` | pre-filled from `tenant.name`, editable | yes |
| `contact_name` | typed or pre-filled from the owner's own display name, editable | yes |
| `contact_phone`, `contact_email` | typed by the owner | at least one |
| `message` | typed (plain text, length-capped) | yes |
| `products` | ids chosen from **that producer's** catalogue | no |
| `indicative_note` | typed free text ("circa 10 kg a settimana"), **never pre-filled from invoices, stock or sales** | no |

The payload is a **copy** written at the moment of sending, not a live view into the tenant. Withdrawing appends `withdrawn`; the
producer's read function then returns the request without its payload. The e-mail notice to the producer says only that a new request
is waiting in Costì (no venue name, no contact data, no message: LP3 test 6). DigiAlto's console sees request **counts** per producer,
never contents (LP3 test 11).

**Not shareable in the base plan:** lot or invoice data, prices, volumes derived from ledgers, menus, a "customer reference" the producer
could publish. Anything else needs a new plan.

### 2.5 Roles and session modes (consistent with ADR-037 and ADR-038)

| Mode | Who | JWT role | Claims | Reaches |
|---|---|---|---|---|
| tenant mode (ADR-038) | owners, chefs, waiters; the platform admin as `admin` | `authenticated` | `tenant_id`, `app_role` | tenant RLS; `public.network_*` (owner/admin) |
| console mode (ADR-037) | the platform admin | `platform_staff` | none | `public.platform_*` metadata functions, including `public.platform_network_*` |
| **producer mode (new)** | producer members | **`network_producer`** (new NOLOGIN role, granted to `authenticator`) | `producer_id` | only `public.producer_*` definers and the `producer-evidence` bucket |

- **The hook (after SP2)** selects producer mode for an auth user that has an active `network.producer_member` row: it sets the role
  claim to `network_producer`, adds `producer_id`, and adds **no** tenant claim. It never trusts incoming claims (as today).
- **One login is either a venue login or a producer login (ND7).** Triggers refuse a `producer_member` row for an auth user with any
  `app_user` row or a `platform.staff` row, and an `app_user` row for an auth user with a `producer_member` row (the same technique as
  ADR-037's `platform_support` rule). A person who runs a venue and a farm uses two logins.
- **`app.producer_id()`** returns the claim's producer only if the member row is active and the producer's status allows the call
  (`invited` or `active` for reads, `active` for writes); otherwise every producer function refuses with `producer_inactive`.
- **Second factor:** producers may enrol TOTP through the same self-service screens as owners (wired for producer mode in LP1, test 11),
  not required by default (ND8). Producer sessions see no venue data, which is why the default differs from owners'.
- **Why a separate role and not just "no tenant claim":** with no tenant claim, `app.tenant_id()` is null and every tenant policy already
  returns nothing; the separate role adds a second wall (no table grants at all), exactly as ADR-037 argues for console sessions. If the
  hosted stack refuses the custom role (SP0 T2 / LP0 tests 1–2), V5 applies.
- **Routes:** producer screens live in `src/app/(producer)/produttore/**` on the normal app host (ND12); their API in
  `src/app/api/producer/**` behind a new `withProducerApi` wrapper (producer mode required, Zod strict bodies, the error format of
  `withApi`). Tenant routes answer 401/403 to a producer token because `withApi` finds no tenant role. Every screen reads `/api/*` JSON
  (`CLAUDE.md` rule 6).

### 2.6 RLS and grants sketch

| Object | `anon` | `authenticated` (tenant mode) | `network_producer` | `platform_staff` | `service_role` |
|---|---|---|---|---|---|
| tables in schema `network` | none | none | none | none | select (scripts, tests, erasure); deletes only inside the erasure functions |
| `public.producer_*` definers | — | — | execute; each filters by `app.producer_id()` | — | — |
| `public.network_*` definers (search, detail, offers, settings, send, withdraw, links, check, suggestions) | — | execute; each checks `app.role()` (owner/admin; send: owner), `app.require_feature('producer_network')`, and for writes `app.require_writable()` | — | — | — |
| `public.platform_network_*` definers | — | — | — | execute, `aal2`, platform audit on writes | — |
| `public.bind_producer_invitation`, `network.erase_producer` | — | — | — | — | execute only |
| tenant-side link and claim tables in `public` (§3.3, §4.5) | none | owner/admin by the standard tenant policy | none | none | select |
| bucket `producer-evidence` | none | none | insert/select own `<producer_id>/` folder | select (signed URL created in console mode) | — |

**Invariant scope, made explicit (to be recorded in LP0's ADR, extending ADR-037's paragraph):** "every table has `tenant_id` and RLS"
applies to tenant data. Schema `network` holds producer data, which is not tenant data: its tables have RLS on, no API grant, and a
pgTAP catalogue test lists them by name (LP1 test 8). The one tenant-linked table in `network` (`contact_request` and its events) carries a
non-null `tenant_id` and is in SP5's catalogue test. If the founder wants `CLAUDE.md` rule 6 to say so in words, the line is added in
LP1's pull request, with the code (the ADR-040 practice), not before.

---

## 3. Owner side

### 3.1 Discover and search ("Rete produttori")
- **Where:** a new section under Fornitori, `/fornitori/rete`, owner and admin only (ND6), visible when `producer_network` is on.
- **Filters:** province (`network.province`; defaults to the owner's chosen provinces in `public.network_settings (tenant_id,
  provinces text[])`, ND9), category (fixed list), designation (from `network.designation`), free text over display name and product
  names (length-capped, parameterised).
- **Results:** active producers with at least one active product; each card shows display name, comune and province, categories,
  designations with their status label (§4.3), "Offerte riservate" when a current offer exists, and "Già tuo fornitore" when the venue
  linked it (LP4). Detail page: published profile, catalogue, current offers, designations with label and register link.
- **Functions:** `public.network_search(p_provinces text[], p_category text, p_designation uuid, p_query text, p_page int)`,
  `public.network_producer_detail(p_producer uuid)`, `public.network_offers(p_producer uuid)`; all `stable`, payload-whitelisted, writing
  nothing (ND10); `public.network_set_provinces(p_provinces text[])` for the settings.

### 3.2 Contact request flow (sequence)
1. Owner on a producer's page → "Richiedi contatto" → form (§2.4) → **preview screen** listing exactly what the producer will receive.
2. `POST /api/rete/richieste` → `withApi({ roles: ['owner'], feature: 'producer_network' })` → Zod strict body → `public.network_send_request(...)`
   → checks owner, feature, writable tenant, active producer → writes `network.contact_request` + `sent` event in one transaction → returns
   the request id.
3. The existing mail path sends the producer's active members a data-free notice (§2.4).
4. Producer on `/produttore/richieste` → `public.producer_requests()` (own requests, payload unless withdrawn, no tenant id) → may mark
   `read` / `answered` (`public.producer_mark_request`). The conversation continues by phone or e-mail, outside Costì.
5. Owner sees status on `/fornitori/rete/richieste` (`public.network_my_requests()`), may withdraw (`public.network_withdraw_request`).

### 3.3 Linking a venue's suppliers to network producers (LP4)
- `public.supplier_network_link_event (tenant_id, supplier_id, producer_id, kind 'linked'|'unlinked', created_by, created_at)` and
  `public.supplier_item_product_link_event (tenant_id, supplier_item_id, product_id, kind, created_by, created_at)`: tenant data in
  `public`, append-only, current link derived; owner/admin only.
- `public.network_link_suggestions()` proposes a link **only on exact equality** of the normalised `supplier.vat_number` and
  `network.producer.vat_number`; item↔product suggestions only on exact `supplier_item.supplier_code` = `product.producer_code` within an
  already linked supplier. No fuzzy name matching. The owner confirms each one.
- With P2-7, supplier VAT and line codes come straight from the e-invoice XML, so these exact matches become the normal case (P2-7's plan
  decides which XML element feeds `supplier_code`; not assumed here).

### 3.4 Smart suggestions: options ranked by privacy, then effort

| # | Option | Data it uses | Who could learn what | Effort | In this plan |
|---|---|---|---|---|---|
| S1 | **Rule-based from the venue's own purchases and menu**: match the catalogue's categories, designations and product names against the venue's `ingredient.category`, ingredient names used by recipes of active menu items, and existing supplier links | the venue's own rows + the public catalogue, read in the venue's own session | nobody outside the venue; nothing is written | S | **base, LP6** |
| S2 | **Owner-stated interests**: provinces and categories the owner ticks | `network_settings` (tenant data) | nobody outside the venue | S | **base, LP3 (settings) and LP6 (ranking)** |
| S3 | **Season and validity rules**: in-season products and current offers first | the public catalogue | nobody | S | **base, LP6** |
| S4 | **"Popular near you"**: counts of venues in a province buying a category from network producers | **other venues' data, aggregated** | DigiAlto would process every venue's purchase data for a purpose that benefits others; small counts can identify a venue | M | **V4 only**, behind the adviser, the DPA and each owner's opt-in |
| S5 | **AI-generated suggestions** from the venue's data | venue data sent to a model provider | a sub-processor sees venue purchase data for a new purpose | M | **not planned** (§6) |
| S6 | **Demand signals to producers** ("10 venues looked for pecorino") | venues' searches | producers learn about venues' interest | M | **not planned**: breaks ND10 |

Cross-tenant use of venue data (S4, S6) is flagged here, as instructed: **DigiAlto processes venue data as processor (platform plan §6.1;
adviser to confirm) and should not use it for other venues without the adviser's confirmation, the DPA's wording and each owner's
consent.** This plan makes no legal claim about what is allowed; it simply does not build it in the base.

---

## 4. Local traceability and designations

### 4.1 What the official sources say (checked 2026-11-14)

How these were checked: web searches returned the official texts' URLs and excerpts; the official hosts (`eur-lex.europa.eu`,
`legislation.gov.uk`, `boe.es`) **could not be opened from this session** (the session's network settings refused them), so each fact
below is stated only as far as the quoted excerpt of the official source supports it. LP0 test 4 re-reads both entries on eAmbrosia itself
before anything is seeded.

| Fact | Status | Source |
|---|---|---|
| **"Cinta Senese" is registered as a PDO (DOP)**, Italy, **class 1.1 "fresh meat (and offal)"**, by Commission Implementing Regulation (EU) No 217/2012 of 13 March 2012 ("entering a name in the register of protected designations of origin ... [Cinta Senese (PDO)]"), adopted under Regulation (EC) No 510/2006 | **confirmed by excerpts of the official text** | S1 (legislation.gov.uk copy of Reg. 217/2012) |
| The Cinta Senese product specification had a non-minor amendment approved by Commission Implementing Regulation (EU) 2020/412, which refers back to Reg. 217/2012 | confirmed by excerpt | S2 (EUR-Lex, Reg. 2020/412) |
| A 2026 MASAF document is titled as a temporary amendment of the Cinta Senese specification; news reports tie temporary changes to African swine fever | **reported; content not read** | S3 (MASAF PDF hosted by 3tres3), S4 (news) |
| Whether cured products ("salumi di Cinta Senese") may carry the name | **not established** (the registration found is for fresh meat) | — |
| **"Chianti Classico" is a registered wine PDO**, file **PDO-IT-A1235**; an amendment (AM03) was approved and communicated in the Official Journal (C/2024/1036); an earlier amendment carries AM02 | **confirmed by excerpts of the official communication** | S5 (EUR-Lex C/2024/1036) |
| "Chianti Classico" and "Chianti" are **separate** PDOs | confirmed by the Commission's Chianti PDO page as quoted | S6 |
| On Italian labels, **DOCG and DOC are "menzioni specifiche tradizionali"** used for PDO wines (Law 238/2016, "Testo unico del vino") | confirmed by excerpts of the law's text (AIS copy); consolidated text on Normattiva not opened | S7 |
| Chianti Classico's labels use **DOCG** | secondary (consortium and regional tourism sources), consistent with S5 and S7 | S8 |
| Whether **IGT** is the Italian traditional term for PGI wines | **not confirmed in this session** | — |
| EU framework: **Regulation (EU) 2024/1143** (11 April 2024) covers GIs for wine, spirit drinks and agricultural products, and TSGs (STG); it **repeals Regulation (EU) No 1151/2012** | confirmed by several summaries of the official text | S9 |
| **eAmbrosia** is the EU's legal register of GIs for agricultural products, wine, spirits and aromatised wine | confirmed by the Commission's GI-registers page | S10 |
| **PAT**: national list kept by the ministry (d.lgs. 173/1998 art. 8; DM 350/1999), revised every year (the 2025 decree is the XXV revision, MASAF prot. 0110765); the list "costituisce un primo censimento", and inclusion "non è costitutivo di diritti" | confirmed by excerpts (decree PDF hosted by ARSIAL; parliamentary and regional sources) | S12, S13 |
| Italian wine control structures are entered in a register published on the **SIAN** portal (public and private sections) | confirmed by excerpt of a ministerial decree (FAOLEX copy) | S11 |
| A list of operators certified for Cinta Senese or Chianti Classico that Costì could check automatically | **not found** (A3) | — |

### 4.2 The designation catalogue (`network.designation`)
- **Who writes it:** DigiAlto only, by migration, one row per designation **after a person has read the entry on eAmbrosia** (for PDO,
  PGI, TSG, wine and spirit GIs) or on the latest MASAF PAT decree (for PAT). Each row stores `register_ref`, `source_url`, `checked_on` and
  `checked_by_staff`. Producers can only choose from it; they cannot add a name.
- **First rows:** "Cinta Senese" (`pdo`, label "DOP", class 1.1) and "Chianti Classico" (`wine_pdo`, label "DOCG", ref PDO-IT-A1235), both
  after LP0 test 4. Further rows are added when an invited producer needs one, through the same check.
- **PAT rows** have `is_protected_name = false`. Their label reads "Prodotto agroalimentare tradizionale (elenco MASAF)" and is never
  rendered as DOP/IGP/STG (LP2 test 6).
- **Label wording** comes from the row's `label_it`, chosen from a fixed list per `kind`; no free text. A `wine_pgi` row cannot be seeded
  until its Italian label is confirmed from a source (the IGT row of §4.1 is open). Italian copy for explanations is drafted by DigiAlto's
  copywriter and approved before use (brand.md line 61).

### 4.3 How a designation claim is verified (declared vs. verified)

| Status (derived from events) | Meaning | How it is reached | Shown to venues as | Can feed the dish text? |
|---|---|---|---|---|
| `declared` | the producer says product P carries designation D | producer, `public.producer_declare_claim` | "Dichiarato dal produttore" | **no** |
| `verified` | DigiAlto has seen evidence that P is certified for D for this producer, valid until a date | platform admin, console, `aal2`: `public.platform_network_verify_claim(p_claim, p_valid_until)` after reading the evidence file (a certificate or attestation from the control body or consorzio, A2); platform audit row | "Certificazione verificata da DigiAlto fino al <data>" (wording covered by Q-L, §9.2) | **yes, for lots received on or before `valid_until`** |
| `expired` | `verified`, but the date asked is after `valid_until` | computed (no stored column) | "Certificazione scaduta" | no, for lots received after `valid_until` |
| `rejected` / `revoked` | DigiAlto refused, or withdrew after new information | platform admin, with a reason code | not shown | no |

DigiAlto checks that the evidence names the producer, the product and the designation; it does not certify the product, and the UI
never says it does. The producer sees an in-app reminder on its home before `valid_until` (LP2 test 10; no e-mail by default). A temporary
change of a specification (as reported for Cinta Senese, §4.1) is handled by revoking or re-verifying claims; Costì does not interpret
specifications.

### 4.4 Link to P2-2 lot trace and P2-7 XML lines
The chain from a plate back to a producer, all of it inside the tenant except the last hop:

```
order_line ──(batch_movement consume / stock_movement consumption, ref_type 'order_line')──▶ batch / direct consumption
batch ──(batch_input, raw_lot_id or NULL)──▶ raw_lot (supplier_id, invoice_line_id, lot_code, received_on)
raw_lot.invoice_line_id ──▶ invoice_line.supplier_item_id ──(LP4 link)──▶ network.product ──▶ verified designation_claim
raw_lot.supplier_id ──(LP4 link)──▶ network.producer (same producer as the product)
```

- P2-2 builds the first two hops (forward and backward trace); LP5 calls P2-2's trace functions and adds only the last hop.
- P2-7 changes nothing in this chain: an XML line becomes an `invoice_line` like a PDF line, with an exact supplier VAT and, when the
  producer prints them, article codes and a lot code. LP5 treats `lot_code` the same whatever its source (LP5 test 9).
- A delivery without a lot code, an unlotted shortfall slice (`batch_input.raw_lot_id null`), a direct consumption without a lot, or a lot
  from an unlinked supplier is a **gap**, reported by name; nothing is inferred (A5, A6).

### 4.5 The dish check: "Cinta Senese DOP — Produttore X", truthfully
- **The owner states the claim:** `public.menu_designation_claim_event (tenant_id, menu_item_id, ingredient_id, designation_id,
  producer_id, kind 'claimed'|'withdrawn', created_by, created_at)`, tenant data, append-only, owner/admin.
- **The check:** `public.designation_check(p_menu_item uuid, p_from date default null, p_to date default null)`, `stable`, returns per
  claim:
  - `now`: `ok` when **every** portion currently on hand that feeds the dish (available batches of its recipe and sub-recipes, by P2-2's
    trace) and the ingredient's current direct-consumption lots come from lots that (a) belong to a supplier linked to producer X, (b) map
    to a product of X with a `verified` claim for D, and (c) were received on or before that claim's `valid_until`; otherwise the list of
    gaps with codes: `lot_missing`, `other_supplier`, `not_linked`, `claim_declared_only`, `claim_expired`, `claim_revoked`, `no_stock`;
  - `served_share` for `[p_from, p_to]`: the share of served portions whose backward trace satisfies (a)–(c), plus the gap counts;
  - `suggested_text` only when `now = ok`: "<name> <label> — <producer display name>", e.g. "Cinta Senese DOP — <producer>". Never
    produced from a `declared` claim, never for a PAT as if it were protected.
- **Keeping it true:** the existing alert-rules job (M16) gains the rule kind `designation_gap`: when a claimed dish turns from `ok` to a
  gap, it raises one owner alert through `app.try_raise_alert` (alerts stay owner-only and in-app, ADR-006).
- **No public output:** Costì shows the check and the text to the owner; it does not print or publish menus (FD20 default).
- **Who reads it:** ND6 (owner and admin; see V6).

---

## 5. Commercial options (no prices, no invented numbers)

### 5.1 Options

| # | Option | What Costì does | Recommended |
|---|---|---|---|
| C-A | **Free listing for producers; module included in venue plans; no commission; no money through Costì** | directory, offers, contact requests, trace check | **default (ND2), for a pilot around tenant #1's province (Siena)** |
| C-B | **Venue-only offers and discounts** (written by the producer) | displays the producer's own terms to entitled venues only; does not set, fund, apply or guarantee them | **in the base plan** (offers are part of C-A) |
| C-C | **Paid listing** for producers (subscription) | see V2 | only if Q-F says so |
| C-D | **Commission** on purchases that started from a Costì contact | see V3 | only if Q-F says so; not recommended |
| C-E | **Paid placement** in search or suggestions | — | not planned (it would break LP6 test 6's deterministic, explained ranking) |

### 5.2 Legal and tax points per option (questions for an adviser, not statements of law)

These are **not** sent to the adviser as a list. The adviser gets the single question Q-L (§9.2), about the default (C-A with C-B); the
C-A/C-B points below are its background. The points for C-C and C-D become that variant's adviser brief only if the founder chooses it.

- **C-A + C-B (default):** Does DigiAlto, by listing producers and passing owner-written contact requests, act as an intermediary with
  obligations beyond its terms with each side? Secondary sources describe Regulation (EU) 2019/1150 (platform-to-business) as covering
  services that let business users offer goods or services **to consumers**, and the Digital Services Act's marketplace section
  (Regulation (EU) 2022/2065, Section 4) as applying to platforms where **consumers** conclude distance contracts with traders (§10 S14,
  S15): does a B2B directory fall outside both? What must the producer terms, the venue terms and the DPA say about the contact request
  (DigiAlto acting on the owner's instruction as processor; DigiAlto as controller of producer accounts)? Do the designation labels and the
  "verificata" wording expose DigiAlto (§4.3)? Do venue-only offers raise any issue under competition or advertising rules? What retention
  period applies to producer data (ND11)?
- **C-C (paid listing, V2):** producers become DigiAlto customers: how DigiAlto invoices them (e-invoicing through SDI; DigiAlto's
  accountant), what the producer terms must contain once money is involved, whether ranking or listing rules then apply.
- **C-D (commission, V3):** whether earning a commission on sales between two businesses requires DigiAlto to hold a particular status or
  registration in Italy (agent or broker rules: **not researched**); how commission is invoiced and on what base; whether producers may
  report their own sales to DigiAlto; and confirmation that venue invoices may **not** be used to compute commission (processor purpose).
- **C-E:** not planned; no question.

---

## 6. Alternatives considered

- **Producers as tenants** (a venue type "producer"): reuses tenancy as is; but a producer would need cross-tenant reads to receive
  requests, which ADR-038 rejects ("no policy gains an organisation or platform branch"), and would carry ledgers, roles and claims it
  does not need. Rejected for a separate party in schema `network`.
- **Producers as platform staff** (a role like `platform_support`): no new mode; but platform staff read tenant metadata, and producers
  must read none. Rejected.
- **A separate application and Supabase project for the network:** the strongest isolation; but two auth systems, and contact requests
  would cross projects with secret keys outside the places `CLAUDE.md` rule 2 allows. Rejected; revisit if the network becomes its own
  product.
- **RLS policies with table grants to `network_producer`** instead of definers: simpler reads; but opens the Data API surface to
  producers and loses the payload whitelist tests SP3 uses. Rejected.
- **Producer-declared designations only:** fastest; but the dish text would rest on a producer's word. Rejected for the dish text;
  declared claims are shown, labelled.
- **Automatic verification against a register of certified operators:** best, if it existed in machine-readable form; none was found
  (A3, A4). Rejected for now; LP0 test 4 looks again.
- **AI-generated suggestions from venue data (S5):** a sub-processor would see venue purchase data for a new purpose; rule-based S1–S3
  cover the founder's "smart suggestions" without it. Rejected.
- **Commission as the default (C-D):** needs attribution that tempts reading tenant invoices for DigiAlto's own billing, and raises
  intermediary questions. Rejected as default.
- **Maps and distance with a geocoding provider:** a new sub-processor and venue addresses; provinces suffice for a local pilot (ND9).
  Rejected.
- **In-app chat:** more personal data, moderation and retention; the request plus phone or e-mail does the job. Rejected for the base.
- **Public open sign-up for producers through Supabase Auth:** against FD5's reasoning (spam, a CAPTCHA provider, Auth sign-up on).
  Rejected; an application form without Auth sign-up is V1.
- **Linking out to consorzi member lists only:** cheapest; but no venue-only offers, no contact flow, no link to the venue's own trace.
  Kept as content: a producer may publish its consorzio page URL in its profile.

---

## 7. Build plan: milestones

Each milestone = one `/feature` run on a `feat/lp<NN>-<name>` branch with its own plan in `docs/plans/<date>-lp<NN>-<name>.md`, holding
the per-commit steps, each with its test. Conventions of the project plan §5a and platform plan §10 apply: every endpoint has a role test
(pgTAP + API) and a strict-body test; new code ≥ 80% line coverage; fake fixtures only ("Osteria Demo A/B", "Produttore Demo 1/2", VAT
`IT00000000000`-style, addresses on `example.test`); fake clock. **Every milestone also passes the tenant #1 golden tests (G) and the
cross-tenant suite on the multi-venue fixture (X) of platform plan §6.5**, not repeated below. Designation rows in fixtures are the real
seeded rows (public register data); producers in fixtures are fake.

| # | Milestone | Size | Depends on | Key test (full list in 7a) |
|---|---|---|---|---|
| LP0 | Spike, ADR and register check | S | SP0, SP3 | a `network_producer` token is accepted for `execute` and refused on every `public` table; eAmbrosia entries recorded |
| LP1 | Producer party: schema, role, hook mode, invitation, terms, suspension | M | LP0, SP2, SP3, SP7 | producer sessions read 0 rows of every tenant table; tenant sessions read 0 rows of producer data |
| LP2 | Profile, catalogue, offers, designation catalogue, claims and DigiAlto verification | M | LP1 | only the console can verify; PAT never labelled as protected |
| LP3 | Owner discovery, venue-only offers, contact requests, erasure coverage | M | LP2, SP5, SP6, SP10 | payload whitelist; a producer sees only its own requests and no tenant id; the notice e-mail carries no venue data |
| LP4 | Supplier and item linking (exact VAT and code) | S | LP2, SP5, SP6 | exact matches only; producers cannot learn they were linked |
| LP5 | Dish designation check on P2-2's trace, gap alert | M | LP2, LP4, P2-2 | text only when every current portion traces to verified lots; each gap named |
| LP6 | Rule-based suggestions inside the tenant | S | LP3, LP4 | another tenant's data never changes the result; nothing written |

Order: LP0 → LP1 → LP2 → (LP3 and LP4 in either order) → LP5 and LP6. Sizes: 3 S (LP0, LP4, LP6), 4 M (LP1, LP2, LP3, LP5).

### 7a. Milestone specifications

**LP0 — Spike, ADR and register check** (S)
- In: a throwaway branch, the local stack and staging; results in `docs/plans/<date>-lp00-spike.md`; the ADR draft (next free number,
  status proposed) "Producers are a party outside tenants, in schema `network`, with their own session mode".
- Acceptance tests:
  1. With SP0 T2's mechanism, a token whose role claim is `network_producer` can `execute` a test definer through the Data API and gets
     permission denied on a select of every `public` table (local stack and staging; recorded pass/fail).
  2. Storage: a policy `to network_producer` on a test bucket allows insert and select in the token's own `<producer_id>/` folder and
     refuses another folder (recorded pass/fail).
  3. On the throwaway branch, the SP2 hook with a producer branch gives a member-only auth user role `network_producer` and claim
     `producer_id`, and gives a tenant member the tenant claims as before (recorded).
  4. A person reads eAmbrosia for "Cinta Senese" and "Chianti Classico" and records type, file or regulation reference, product class and
     status with URL and date, plus whether the register offers an export or API (A4) and whether any public list of certified operators
     exists for either name (A3). Any difference from §4.1 is reported to the lead before LP2 seeds anything.
  5. The ISTAT province list's source URL and licence are recorded (A7); if it may not be reused, the spike says so and LP3 uses a
     hand-written list of province sigle.
  6. The ADR draft exists, cites this plan and amends ADR-037's "invariant scope" paragraph for schema `network`.
- If test 1 or 2 fails: V5 applies to LP1–LP2.

**LP1 — Producer party** (M)
- In: schema `network` (not exposed by the Data API); `producer`, `producer_status_event`, `producer_member`, `producer_invitation`,
  `terms_acceptance`; Postgres role `network_producer`; the hook's producer branch (on SP2's hook, re-pinned on purpose); `app.producer_id()`;
  triggers for ND7; `public.platform_network_create_producer`, `public.platform_network_suspend_producer`,
  `public.platform_network_reactivate_producer`, `public.platform_network_producers()` (console list, metadata only);
  `scripts/producer-invite.ts` with `public.bind_producer_invitation`; `public.redeem_producer_invitation`; `/produttore/benvenuto`;
  `withProducerApi`; TOTP self-enrolment reachable in producer mode (not gated, ND8).
- Acceptance tests:
  1. pgTAP catalogue: `network_producer` has no privilege on any `public` table and `execute` only on `public.producer_*` and a named
     exempt list (sign-out, TOTP self-service); a select on any tenant table → permission denied.
  2. With a producer-mode token, every `public` function executable by `authenticated` → permission denied, and `app.tenant_id()` is
     null.
  3. With tenant-mode tokens (owner, admin, chef, waiter of Osteria Demo A), `public.producer_*` → permission denied, and no `network`
     table is readable.
  4. Triggers: a `producer_member` row for an auth user with any `app_user` or `platform.staff` row → error; an `app_user` row for an auth
     user with a `producer_member` row → error.
  5. Invitation: console create → `scripts/producer-invite.ts` → e-mail-code sign-in → redeem with `producer_terms` accepted writes
     exactly one member, one terms row and one `active` status event in one transaction; an invalid IT VAT is refused at create (A1);
     single use; expiry (fake clock); redeem of an invitation bound to another auth user or unbound → 42501, nothing written; redeem
     without accepting `producer_terms` → 422; `bind_producer_invitation` not executable by `anon`, `authenticated`, `network_producer`
     or `platform_staff`; the script writes one platform audit row and its output contains no `@`.
  6. Sign-up stays closed: SP7 test 3's config and route-list tests pass unchanged, and the route list has no producer sign-up page.
  7. Suspension: `platform_network_suspend_producer` appends a status event and a platform audit row; every producer write then returns
     `producer_inactive`; `platform_network_reactivate_producer` restores writes with its own event and audit row; a suspended producer
     disappears from tenant search (LP3 test 2).
  8. Catalogue: every table in schema `network` is in a named list, has RLS on and no privilege for `anon`, `authenticated`,
     `network_producer` or `platform_staff`; every table with a `tenant_id` column is also in SP5 test 8's list.
  9. The secret-key import lint (M0 test 11, as in SP3 test 10) passes; the only new secret-key user is `scripts/producer-invite.ts`.
  10. Hook tests: the tenant-mode and console-mode hook tests of SP2 and SP3 pass unchanged; the hook pin is updated in this PR on
      purpose.
  11. A producer member enrols and verifies a TOTP factor through the self-service screens; producer functions keep working at `aal1`
      (ND8); the factor's issuer is "Costì".
  12. SP3 test 5's whitelist covers `platform_network_producers()` and every `platform_network_*` function of this milestone: no member
      e-mail and no business key in the payload.

**LP2 — Profile, catalogue, offers, designations and verification** (M)
- In: `producer_profile_version`, `product`/`product_version`, `offer_version`, `category`, `province`, `designation` (seed: the two rows of
  §4.2 after LP0 test 4), `designation_claim` and its events; bucket `producer-evidence` and its policies; producer screens
  `/produttore/profilo`, `/produttore/prodotti`, `/produttore/offerte`, `/produttore/denominazioni`; console screen "Verifiche" with
  `public.platform_network_claims()`, `public.platform_network_verify_claim`, `public.platform_network_reject_claim`,
  `public.platform_network_revoke_claim`; the expiry reminder on the producer's home.
- Acceptance tests:
  1. Producer A cannot read or write producer B's profile, products, offers, claims or evidence objects (pgTAP and Storage policy tests).
  2. Strict bodies: unknown keys → 400; every text field length-capped and stored as plain text; a render test shows `<script>` in a
     description escaped on every screen that shows it.
  3. No function lets a producer write `network.designation` or append `verified`; a producer call to any `platform_network_*` function →
     permission denied.
  4. `platform_network_verify_claim` requires console mode at `aal2`, an evidence object for the claim and a `valid_until` date; it
     appends one claim event and one platform audit row; reject and revoke the same with a reason code.
  5. Claim status is derived: `verified` with `valid_until` before the date asked reads `expired` (fake clock); there is no stored status
     column (catalogue test).
  6. A PAT row (`is_protected_name = false`) is labelled with the PAT wording on every payload, never "DOP", "IGP", "STG", "DOCG" or "DOC".
  7. Evidence upload: only PDF, JPEG, PNG up to 4 MiB, path `<producer_id>/<claim_id>.<ext>`; another producer's path → refused.
  8. Offers: `valid_from <= valid_to`; `audience` is `costi_venues` only; withdrawing writes a new version and keeps the old ones; a
     withdrawn offer and every offer of a suspended producer are not returned to venues (checked in LP3 test 2).
  9. SP3 test 5's whitelist covers every `platform_network_*` function of this milestone (claims list: producer id, claim id, designation,
     status, evidence presence, dates; no venue key).
  10. The expiry reminder appears on the producer's home from a named reminder window before `valid_until` and not before it (fake
      clock); no e-mail is sent.
  11. Playwright: a fixture producer edits its profile, adds a product, declares a claim and uploads evidence; in console mode the claim
      is verified; the producer's label changes from "Dichiarato dal produttore" to the verified label.

**LP3 — Owner discovery and contact requests** (M)
- In: feature key `producer_network` in `platform.feature` (tier placement: FD3); `public.network_settings` and
  `public.network_set_provinces`; `public.network_search`, `public.network_producer_detail`, `public.network_offers`; `/fornitori/rete`
  screens; `network.contact_request` and its events; `public.network_send_request`, `public.network_withdraw_request`,
  `public.network_my_requests`; producer inbox `public.producer_requests`, `public.producer_mark_request`; the data-free notice through the
  existing mail path; request counts in `public.platform_network_producers()`; SP10's `platform.erase_tenant` and tenant export extended to
  `network.contact_request` and its events; `network.erase_producer` (service role, script `scripts/producer-erase.ts`) refusing with
  `retention_not_set` until ND11's period is set.
- Acceptance tests:
  1. Roles: owner and admin read search, detail and offers and write `network_settings` (province codes from `network.province` only,
     unknown code → 422); chef and waiter → 403 in the API and 42501 in SQL; feature off → 403 `feature_disabled` in the API and P0001
     `feature_disabled` in SQL.
  2. Search returns only `active` producers with at least one active product; suspended or withdrawn producers and their offers, and
     withdrawn offers, never appear; filters by province, category and designation work on fixtures; the query text is length-capped;
     every result key is in a whitelist (no member e-mail unless published in `published_contacts`, no member id).
  3. Send: owner only (admin → 42501, ND4); a suspended or cancelled tenant → 423 `tenant_read_only`; the payload keys are exactly the
     §2.4 whitelist, any other key → 400; pgTAP lists `network_send_request`'s arguments and finds none beyond the whitelist; a static
     import test finds no ledger, cost or invoice module imported by the route handler.
  4. Producer B reads 0 of the requests sent to producer A; `producer_requests` returns no `tenant_id` key (whitelist test); the producer
     marks its own request `read` and `answered`; marking another producer's request → not found.
  5. Withdraw: after `withdrawn`, `producer_requests` returns the request without payload; the owner still sees it with its history in
     `network_my_requests`.
  6. The notice e-mail's subject and body contain no venue name, contact data or message text (template test); it goes only to the
     producer's active members.
  7. Erasure and export: SP10's `erase_tenant` on Osteria Demo A removes A's requests and events and leaves producers and Osteria Demo
     B's requests intact; SP10's tests stay green; A's full export contains its requests; `network.erase_producer` refuses with
     `retention_not_set` while ND11's period is unset.
  8. No producer-side analytics: `network_search`, `network_producer_detail`, `network_offers` are `stable` and no table records a
     search, view or impression (catalogue test).
  9. The waiter payload test (M0 test 10) extended: `/api/me` for a waiter lists features without any money key, and no network
     section is reachable.
  10. Playwright: the owner searches, opens a producer, sends a request after the preview and sees it in "Richieste"; the producer sees
      it in its inbox.
  11. The console reads request **counts** per producer from `platform_network_producers()`; SP3 test 5's whitelist finds no key carrying
      request payload, venue name or contact data.

**LP4 — Supplier and item linking** (S)
- In: `public.supplier_network_link_event`, `public.supplier_item_product_link_event` (append-only, derived current link);
  `public.network_link_suggestions()`; `public.network_link_supplier`, `public.network_unlink_supplier`, `public.network_link_item`,
  `public.network_unlink_item`; a "Produttore della rete" panel on the supplier screen; "Già tuo fornitore" in search results.
- Acceptance tests:
  1. Suggestions only on exact equality of normalised VAT numbers (supplier ↔ producer) and of `supplier_code` = `producer_code` within a
     linked supplier (item ↔ product); near matches are not suggested; suspended producers are not suggested.
  2. Links are written only by owner or admin on confirmation (role tests); chef and waiter → 42501; a suspended tenant → 423.
  3. `network_producer` and `platform_staff` have no privilege on the link tables (catalogue), and no `producer_*` or `platform_network_*`
     function returns link data.
  4. Append-only: UPDATE and DELETE refused; unlinking is a new event; the derived current link follows the newest event.
  5. An item link is refused unless the item's supplier is currently linked to the product's producer.
  6. Both tables pass pgTAP 001 (tenant_id, RLS) and the cross-tenant suite.
  7. `network_search` marks a producer "già tuo fornitore" for the tenant that linked it and for no other tenant (Osteria Demo B sees no
     mark).

**LP5 — Dish designation check** (M)
- In: `public.menu_designation_claim_event`; `public.designation_check(p_menu_item, p_from, p_to)` on P2-2's trace functions; the
  `designation_gap` rule kind in the alert-rules job and its alert kind; screen `/fornitori/tracciabilita` (claimed dishes with status and
  gaps) and a link from the menu item screen.
- Acceptance tests:
  1. Fixture: a dish whose recipe uses ingredient I, all available batches fed by lots of a supplier linked to Produttore Demo 1, items
     linked to its product with a `verified` "Cinta Senese" claim valid at every lot's `received_on` → `now = ok` and `suggested_text` =
     "Cinta Senese DOP — Produttore Demo 1".
  2. One batch input of I with `raw_lot_id null` → `lot_missing`, no text.
  3. One lot of I from an unlinked supplier → `other_supplier` (or `not_linked` when the item link is missing), no text.
  4. The claim only `declared` → `claim_declared_only`; `verified` with `valid_until` before one lot's `received_on` → `claim_expired`;
     `revoked` → `claim_revoked`; none produce text.
  5. An ingredient reached through a sub-recipe batch is traced through the sub-batch's `batch_input` (two-level fixture), and a direct
     `consumption` movement without a lot is a `lot_missing` gap.
  6. `served_share` over a date range equals a hand-computed fixture (backward trace), with gap counts.
  7. The rules job raises exactly one `designation_gap` alert when a claimed dish turns from `ok` to a gap, none while it stays a gap;
     the owner reads it; admin, chef and waiter have no row (alert RLS unchanged).
  8. Roles: owner and admin read the check and write claims; chef and waiter → 42501 (ND6); no payload key carries money (whitelist).
  9. Lot codes from PDF extraction, typed at review, or (with P2-7) XML give the same result for the same `raw_lot` rows.
  10. The check writes nothing, in `public` or in `network` (it is `stable`; catalogue test).
  11. Playwright: the owner opens "Tracciabilità"; the fixture shows one dish with its suggested text and one dish with its gaps, labelled
      in Italian.

**LP6 — Rule-based suggestions** (S)
- In: `public.network_suggestions()` (`stable`, owner/admin, feature-gated) ranking by fixed rules with reason codes
  (`categoria_ingrediente`, `ingrediente_nel_menu`, `denominazione_nel_menu`, `provincia_scelta`, `di_stagione`, `offerta_attiva`);
  "Suggeriti per te" on `/fornitori/rete`.
- Acceptance tests:
  1. Fixture: Osteria Demo A has an ingredient in category "Carni" used by an active menu item, and SI among its chosen provinces; a
     producer in SI with a product in "Carni" carrying the Cinta Senese designation ranks first with the expected reason codes.
  2. Adding or removing Osteria Demo B's ingredients, recipes, suppliers and links never changes A's result.
  3. The function is `stable`, writes nothing and records nothing; no `producer_*` function can tell a producer it was suggested.
  4. Producers already linked to one of the venue's suppliers are marked "già tuo fornitore", not hidden.
  5. Owner and admin only; feature off → 403 / P0001.
  6. Ranking is deterministic and documented: the same input gives the same order, and the order follows the rule table in the
     milestone plan (no paid factor).

### 7b. Variants

**V1 — Producer application form** · Trigger: the founder revisits ND1 (wants producers to apply on their own) · Replaces: none (adds an
entry before §2.2 step 1)

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V1.1 | `network.producer_application` and the anon definer `public.producer_apply(...)` behind the ADR-032 HMAC gate pattern, with per-address and per-day limits; no auth user is created | migration | strict body (unknown key → 400); over the limit → 429; after a submission no row exists in `auth.users`; SP7 test 3 still passes |
| V1.2 | Page `/produttori/candidatura` with the privacy notice (text by the adviser) under the nonce CSP | `src/app/(public)/produttori/candidatura/page.tsx` | Playwright submits the fixture; the notice link is present; no third-party request is made |
| V1.3 | Console review: `platform_network_accept_application` (creates producer and invitation, then §2.2's flow) and `platform_network_reject_application` | migration, console screen | each writes one platform audit row; a rejected application stays until ND11's period, and its erasure call refuses with `retention_not_set` while the period is unset |

**V2 — Paid listing for producers** · Trigger: Q-F answered "revenue line" with listing fees, and the adviser has answered C-C's points
(§5.2) · Replaces: none

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V2.1 | `network.producer_plan_event` (append-only; plan key, `effective_at`, no amount) | migration | current plan derived from the newest effective row; UPDATE/DELETE refused |
| V2.2 | Listing gated by plan: search and suggestions return only producers with an active plan | migration | a producer without an active plan is not listed; it still reads its existing requests |
| V2.3 | Producer terms version with fees (text by the adviser); writes refused until accepted | migration, `/produttore/benvenuto` | a member who has not accepted the new version gets 422 on every write |
| V2.4 | Console shows each producer's plan state; billing stays manual (platform FD4 pattern) | console screen | whitelist test: no card, IBAN or amount key in any payload |

**V3 — Commission on introduced purchases** · Trigger: Q-F answered "commission" **and** the adviser has answered C-D's points (§5.2) ·
Replaces: none

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V3.1 | `network.commission_statement` written by the producer per period, referencing its own contact request ids and the amounts it declares | migration, `/produttore/estratti` | only the producer writes it; no function joins any `public` invoice, stock or sales table to it (catalogue and static tests) |
| V3.2 | Console report of statements | console screen | DigiAlto sees statements; tenant roles get 42501; venues see no statement |

**V4 — Cross-tenant aggregated suggestions ("popolari in zona")** · Trigger: the adviser confirms a lawful basis and the DPA wording, the
DPA is updated and the founder approves · Replaces: none (adds a reason to LP6)

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V4.1 | `public.network_aggregation_consent_event` (owner opt-in, default off, append-only) | migration, settings screen | only the owner writes it; a tenant without opt-in is excluded from the next run |
| V4.2 | Cron service `/api/cron/network-aggregate` (secret key in a cron service, as rule 2 allows) writes `network.area_signal` (province × category counts of opted-in tenants buying from linked network producers) only when the group reaches the minimum size set with the adviser | `src/app/api/cron/network-aggregate/route.ts`, migration | below the minimum no row is written; output rows have no tenant id and no amount |
| V4.3 | Reason `popolare_in_zona` in `network_suggestions` | migration | never shown when the asking tenant is the only contributor to the signal |
| V4.4 | Notice to every tenant through `platform.notice` before the first run | migration | the job skips a tenant not yet notified (SP3 test 9's notified date) |

**V5 — Producer sessions as `authenticated` with a producer claim** · Trigger: LP0 test 1 or 2 fails (or SP0 T2 fails and the platform
plan's V2 applies) · Replaces: LP1's role parts (LP1 tests 1–2) and LP2's Storage policy part (LP2 tests 1 and 7, Storage side)

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V5.1 | The hook adds `producer_id` and keeps role `authenticated` for producer members | hook migration | for a producer token, every `public` tenant table returns 0 rows because `app.tenant_id()` is null (pgTAP over every table) |
| V5.2 | Every `public.producer_*` checks `app.producer_id()`; every `public.network_*` and tenant function checks the tenant | migrations | catalogue test scanning `pg_policies`: every tenant policy compares `tenant_id` with `app.tenant_id()`; every `producer_*` body calls `app.producer_id()` |
| V5.3 | `producer-evidence` policies `to authenticated` with a producer-claim check | storage migration | tenant tokens are refused on the bucket; producer A is refused on B's folder |

**V6 — The chef reads the designation check** · Trigger: the founder revisits ND6 · Replaces: LP5 test 8's role rule

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V6.1 | `designation_check` allows the chef to read; claims stay owner/admin | migration, screen visibility | the chef reads the check; the waiter gets 42501; the chef cannot write a claim; no money key in the payload |

---

## 8. Risks and mitigations

**Security and privacy**
- *A new kind of outsider with a login in the same database.* Mitigations: a role with no table grants (LP1 tests 1–3), the hook never
  trusts incoming claims, definers with key whitelists, catalogue tests over schema `network` (LP1 test 8). If the custom role is
  refused: V5.
- *Venue data reaching a producer.* Only through an owner's send, with a preview and a fixed whitelist (LP3 tests 3–4); the copy is
  hidden on withdraw (LP3 test 5); notices carry no data (LP3 test 6); no searches, views or suggestions are recorded (LP3 test 8, LP6
  test 3); links are invisible to producers (LP4 tests 3 and 7). Residual: once a producer has read a request, what it does with the
  contact details is governed by the producer terms (Q-L), not by code.
- *DigiAlto's standing admin membership (FD29)* lets the platform admin see the network screens in a venue, recorded as DigiAlto (SP4).
  It cannot send requests for the venue: sharing is the owner's decision (ND4, LP3 test 3).
- *Fake producers and false claims.* Invitation only (ND1), DigiAlto verification with evidence and expiry, suspension and revocation
  with audit (LP1 test 7, LP2 test 4); declared claims are labelled and never feed dish text (LP5 test 4).
- *Producer content as an attack vector.* Plain text only, length caps, framework escaping, no images or HTML (LP2 test 2); evidence files
  type- and size-checked in a private bucket (LP2 test 7).
- *Evidence files may contain personal data* (names on certificates). Private bucket, producer and console only; retention ND11.
- *Producer accounts are personal data DigiAlto holds as controller* (assumption; Q-L). Kept only while the producer is in the network;
  erasure refuses until a retention period is set (ND11; LP3 test 7).
- *Producer logins without a required second factor (ND8).* They reach no venue data; the worst case is a defaced profile or false
  offers, which DigiAlto can suspend (LP1 test 7).

**Product and legal**
- *Designation wording.* Registered names are protected by EU law (§4.1, S9). Costì produces a designation sentence only from a verified
  claim and a complete trace (LP5), labels PAT as non-protected (LP2 test 6), and leaves the menu text to the owner. Observation for the
  lead, not a finding about this feature: tenant #1's **draft** menu (`docs/client/menu-draft.md` lines 24 and 112; draft, not approved
  facts) uses the name "Cinta Senese" for dishes; whether a menu may use a registered name for product that is not certified is for the
  adviser, and fits as background to Q-L; this plan makes no legal claim.
- *Specification changes* (a temporary change was reported for Cinta Senese in 2026, §4.1). Claims carry `valid_until`; DigiAlto revokes
  or re-verifies; the gap alert tells the owner (LP5 test 7).
- *Words that sound like claims.* "km 0", "filiera corta", "biologico" or "locale" as a guarantee are not used as labels; "locale" means
  only "in a province the owner chose". Any such wording waits for the adviser.
- *Brand rule.* The network and the dish check are not used in sales or client-facing material until they ship (brand.md lines 63–65).
- *Adoption.* Producers may not keep catalogues current: offers have validity dates, profiles show "aggiornato il"; the pilot is small and
  invited.

**Operations**
- *One platform admin (FD28) verifies every claim and invites every producer.* Manual by design for a pilot; the console lists claims
  by expiry; automation only if a register becomes usable (LP0 test 4).
- *Erasure coverage.* Contact requests are tenant-linked rows outside `public`: in SP5's catalogue test (LP1 test 8) and in SP10's erasure
  and export (LP3 test 7).
- *Hook changed again.* Re-pinned once in LP1, with SP2 and SP3 hook tests unchanged (LP1 test 10).

**Performance and cost**
- Catalogue tables are small and indexed on province, category and designation; search reads one schema. The dish check runs on demand
  for the owner and once per rules-job run per claimed dish; both are measured with the existing perf workflow; no figure is promised.
- No new paid service: e-mail notices use the existing mail path; no geocoding, no AI calls.

**Dependencies (name, licence, why)**
- None. No library is added. The ISTAT province list is seed data, not a dependency; its licence is recorded in LP0 (test 5).

**Where every secret lives (new or changed)**

| Secret / credential | Lives in | Used by | When |
|---|---|---|---|
| none for producer sessions, search, requests, links, check or suggestions | — | Postgres roles and user sessions only | LP1–LP6 |
| Supabase secret key, database URL (existing) | GitHub environment secrets (the protected `platform-ops` environment of the platform plan) or the founder's local env for scripts; never in the repo | `scripts/producer-invite.ts`, `scripts/producer-erase.ts`; SP10's `scripts/tenant-erase.ts` (extended) | LP1, LP3 |
| Existing mail-sending credentials for notices | where the existing mail path keeps them today (Vercel env; Supabase Vault for cron jobs, `docs/guides/cron-vault-secrets.md`) | the data-free producer notice | LP3 |
| Producer members' logins (e-mail, optional TOTP) | Supabase Auth (hashed); each producer's own password manager and authenticator | producers | LP1 |
| The platform admin account's login | unchanged (platform plan §11) | console verification and invitations | LP1, LP2 |
| Third-party API keys and account logins | none: the base plan adds no provider. V2 adds none (billing stays manual); a billing provider would only come through the platform plan's V5, with its keys in Vercel env, server-only. V4 uses the existing cron secret | — | — |

---

## 9. Defaults and open questions

### 9.1 Recommended defaults (each "default, founder may revisit")

Researched first; each default is the smallest design that answers the founder's idea safely. A different answer triggers the variant
named, or re-plans the step named.

| # | Default | Why | If revisited |
|---|---|---|---|
| ND1 | Producers join by DigiAlto invitation only; owners point producers out to DigiAlto outside the app | FD5's reasoning applies (no Auth sign-up, no CAPTCHA provider, no anonymous accounts) | V1 |
| ND2 | Free for producers; module included in venue plans (placement: FD3); no commission; no money through Costì | keeps DigiAlto out of payments and attribution; lets the pilot measure interest | V2 or V3 (by Q-F) |
| ND3 | Suggestions only from the venue's own data and the public catalogue (S1–S3) | no cross-tenant use of data | V4 |
| ND4 | Data reaches a producer only when the **owner** sends a previewed, whitelisted request; admin, chef and waiter cannot send | sharing is the controller's decision | re-plan LP3 (no variant drafted) |
| ND5 | Dish text only from `verified` claims and a complete trace; declared claims labelled; nothing published | truthfulness | not revisable without a new plan |
| ND6 | Network screens and the dish check: owner and admin only | offers carry prices; `supplier_item` is owner/admin today | V6 (chef reads the check) |
| ND7 | One login is either a venue login or a producer login | keeps modes and triggers simple, like `platform_support` | re-plan LP1 (no variant drafted) |
| ND8 | TOTP available to producers, not required | producer sessions hold no venue data | re-plan LP1 tests 1 and 11 |
| ND9 | Area = provinces (owner-chosen; pilot around SI, tenant #1's province); no maps | no new provider, no addresses | re-plan LP3 |
| ND10 | No producer-side analytics (no views, searches, impressions) | avoids leaking venues' interest | re-plan LP3 test 8 |
| ND11 | Producer data kept while the producer is in the network; erasure on request after a retention period set with the adviser (Q-L); until set, nothing is erased (FD13 pattern) | same safeguard as venues | — |
| ND12 | Producer screens on the normal app host under `/produttore` | one host fewer than the console; tenant routes refuse producer tokens anyway | re-plan LP1 (a separate host, as for the console) |
| ND13 | Same Next.js app and Supabase project | rule 2 keeps the secret key out of cross-project calls (§6) | — |

### 9.2 One question per party

**Founder (Q-F).** *Is the producers network mainly a service that makes Costì more valuable to venues (free for producers, no money
through Costì, a pilot of invited producers around Siena), or do you want it to become a revenue line from producers, and if so, would you
rather charge a listing fee or a commission?* Recommended default: the first (ND2, C-A with C-B). A listing fee triggers V2, a commission
V3, each after the adviser answers that option's points (§5.2).

**Legal adviser (Q-L).** *In the default design (a free, invitation-only B2B directory; DigiAlto as controller of producer accounts and as
processor of venue data; venue data passed to a producer only when the owner sends a previewed request; designation labels shown as
"declared" or as "verified by DigiAlto until <date>" after DigiAlto has read the control body's certificate; dish wording suggested to the
owner only when that certificate and the venue's own lot trace agree), what must the venue terms and DPA, and the new producer terms, say,
and does anything in this design make DigiAlto an intermediary with further obligations?* Recommended default meanwhile: nothing ships to
real producers before the answer; LP0–LP2 can be built and tested with fake producers. The C-A/C-B points of §5.2 (including the retention
period of ND11) are the background the adviser receives with this question.

**Producers (Q-P), asked to the first invited producers.** *To let a restaurant write, for example, "Cinta Senese DOP — <your farm>" next
to a dish, what can you give us as proof, per delivery, that the product is certified: your control body's certificate (and when it is
renewed) plus the lot code printed on each invoice line?* Recommended default meanwhile: a claim stays `declared` until DigiAlto has seen a
certificate; a delivery without a lot code is a gap (A2, A6).

No other question is open. The provider question that applies whenever a provider is not yet chosen does not arise: the base plan adds
no third-party provider (§8).

---

## 10. Sources (searched 2026-11-14)

The hosts `eur-lex.europa.eu`, `www.legislation.gov.uk` and `boe.es` could not be opened from this session; S1, S2 and S5 are cited from
search excerpts of those official pages and must be re-read on eAmbrosia in LP0 (test 4).

- **S1** Commission Implementing Regulation (EU) No 217/2012 (Cinta Senese PDO), official UK archive copy:
  https://www.legislation.gov.uk/eur/2012/217/data.html
- **S2** Commission Implementing Regulation (EU) 2020/412 (Cinta Senese, amendment): https://eur-lex.europa.eu/eli/reg_impl/2020/412/oj
  (also https://www.legislation.gov.uk/eur/2020/412/data.html)
- **S3** MASAF document titled as a temporary amendment of the Cinta Senese specification (2026), content not read:
  https://www.3tres3.com/3tres3_common/art/it/17464/fitxers/MASAF_2026_0370338_CinaSenese_MODTempLUG26_signed.pdf
- **S4** News on temporary changes and African swine fever (2026):
  https://www.meteoweb.eu/2026/07/peste-suina-africana-toscana-e-ministero-fanno-squadra-piano-straordinario-per-salvare-allevamenti-e-produzioni-dop/1001962829/
- **S5** Communication of approval of a standard amendment, "Chianti Classico" PDO-IT-A1235 (C/2024/1036):
  https://eur-lex.europa.eu/eli/C/2024/1036/oj/eng
- **S6** European Commission, Chianti PDO page:
  https://agriculture.ec.europa.eu/farming/geographical-indications-and-quality-schemes/geographical-indications-food-and-drink/chianti-pdo_en
- **S7** Law 238/2016 (Testo unico del vino): text copy https://aisitalia.it/wp-content/uploads/2022/04/Testo_Unico_del_Vino.pdf;
  consolidated text https://www.normattiva.it/eli/id/2016/12/28/16G00251/CONSOLIDATED (not opened)
- **S8** Chianti Classico DOCG: Consorzio Vino Chianti Classico https://chianticlassico.com/en/consortium; Visit Tuscany
  https://www.visittuscany.com/en/flavors/chianti-classico-docg/
- **S9** Regulation (EU) 2024/1143 on GIs for wine, spirit drinks and agricultural products and TSGs: European Commission
  https://agriculture.ec.europa.eu/farming/geographical-indications-and-quality-schemes/regulations-gis_en; summary
  https://leap.unep.org/en/countries/eu/national-legislation/regulation-eu-20241143-geographical-indications-wine-spirit
- **S10** European Commission, geographical-indications registers (eAmbrosia, GIview, wine traditional terms):
  https://agriculture.ec.europa.eu/farming/geographical-indications-and-quality-schemes/geographical-indications-registers_en; register
  address https://ec.europa.eu/agriculture/eambrosia/geographical-indications-register/ (as given by https://www.eubusiness.com/food/door-origin)
- **S11** Italian decree on the register of control structures for wine designations published on SIAN (FAOLEX copy):
  https://faolex.fao.org/docs/pdf/ita100525.pdf
- **S12** MASAF decree, XXV revision of the national PAT list (2025, prot. 0110765):
  https://www.arsial.it/app/uploads/MASAF_2025_0110765_DecretoElencoprodottiagroalimentaritradizionaliXXVrevisione2025_signed.pdf
- **S13** PAT legal basis and nature of the list: Camera dei deputati https://temi.camera.it/leg19/post/i-prodotti-agroalimentari-tradizionali.html;
  Provincia autonoma di Trento https://www.provincia.tn.it/News/Approfondimenti/Prodotti-agroalimentari-tradizionali-PAT
- **S14** Regulation (EU) 2019/1150 (platform-to-business), secondary summaries: EUR-Lex summary
  https://eur-lex.europa.eu/EN/legal-content/summary/online-intermediation-services-fairness-and-transparency-for-business-users.html;
  https://www.noerr.com/en/insights/the-p2b-regulation
- **S15** Regulation (EU) 2022/2065 (Digital Services Act), marketplace section, secondary summaries:
  https://www.ccpc.ie/enforcement-and-regulation/digital/the-digital-services-act
