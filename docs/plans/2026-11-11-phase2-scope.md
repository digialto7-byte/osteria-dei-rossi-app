# Phase 2 scope proposal — Osteria Dei Rossi app

- **Client slug:** `osteria-dei-rossi` (internal planning document, English)
- **Author:** architect · **Date:** 2026-11-11 · **Branch:** `docs/phase2-scope`
- **Status:** proposal, with the founder's answers of 2026-11-11 recorded (see "Founder decisions 2026-11-11" after Part 1). Documents
  only, no code. Nothing here is a milestone plan yet: each chosen milestone gets its own `docs/plans/<date>-m<NN>-<name>.md` (steps,
  tests, variants) when its `/feature` run starts. The lead records the decisions and the scope changes in DigiAlto-Ops
  `clients/osteria-dei-rossi/context.md`.
- **Inputs read:** `CLAUDE.md`; `docs/prd.md` (scope table, Modules 1–4, Traceability, Hardware, NFRs, Roadmap); `docs/plans/2026-10-21-project-plan.md`
  (§1.3, §1.4, §3.6, §5, §5a.4, §5b, §7); `docs/client-facts.md`; `docs/go-live/phase1-closeout.md`; `docs/plans/2026-11-08-reservations.md`
  (§1, §5b V1–V7, §5c, §7); `docs/plans/2026-11-08-a5b-raw-stock-business-date.md` (Q-A5b-3, indexes); `docs/plans/2026-11-01-m25a-password-login.md`
  (Q204, T7, M-6); `docs/plans/2026-11-01-m25-go-live.md` (§3.6 G-items, T16); `docs/plans/2026-10-29-m20-offline.md`; ADR-006, ADR-022,
  ADR-029, ADR-032, ADR-034 (and the titles of all ADRs); the hardware research of 2026-11-05 (DigiAlto-Ops deliverable, read-only copy).
- **Client facts used:** none beyond the trading name. Every other client fact this proposal touches is `[PENDING founder]` or a draft
  (`docs/client-facts.md`), and is listed as a question, never assumed.

---

## Part 1 — Summary for the founder (plain language)

**What Phase 2 will be.** Phase 1 already does the whole daily job: invoices in, stock and dishes, orders, reports. Phase 2 adds:
1. **Safety for your logins:** a code from an authenticator app when the admin signs in (the owner can choose to use it). You decided
   this comes early in Phase 2, after go-live; it is the first Phase 2 step in the order you accepted.
2. **Things the kitchen can touch:** a label printer, so every batch gets a label with a QR code; scanning the label on a phone opens
   that batch to use it, throw it away or count it. This also gives you a clean "where did this come from" record for inspections and
   recalls.
3. **Alerts you can tune, inside the app:** alerts stay inside the app, as you decided on 2026-10-23 and confirmed on 2026-11-11 (no
   Telegram, no e-mail alerts). Phase 2 makes their thresholds and who sees them adjustable settings instead of fixed rules.
4. **Selling by weight:** dishes priced per etto can be sold by typing the grams; the price and the stock used follow the weight.
   Until then, they are rung up as a fixed portion agreed with the chef.
5. **Smarter numbers and paperwork:** which dishes earn and sell best, a suggested prep list and order list, a file for your
   accountant, and later a check of the app's sales against the tax office's record of the till. These work better once the app has
   several weeks of real sales, so they come later.

**The order you accepted (details in Part 3), plus where selling by weight goes:**
1. **Before go-live:** finish a short list of small fixes the Phase 1 review flagged (one of them is already being built), and agree
   with the chef how per-etto dishes are rung up until selling by weight exists.
2. **Authenticator codes** for the admin (required) and the owner (optional).
3. **"Where did it come from"**: the full chain from invoice to batch to plate, how well the dishes you pushed actually sold, and the
   chef seeing how many covers are booked (numbers only, no names). No new hardware, no new provider.
4. **Labels and scanning** with one Brother label printer printing straight from the phone (no extra box in the restaurant), after a
   test on a real iPhone and a real Android phone. The PRD says nothing is bought until the two-week supervised run is over.
5. **Adjustable alert rules**, still only inside the app.
6. **For the accountant:** an invoice file with the VAT split; a read-only login only if the accountant asks for one.
7. **Selling by weight** (new step after the six you accepted; Part 3 says why it sits there).

After these: the demand forecast with prep and order lists, the dish-performance matrix, a temperature-sensor pilot (later, and only
after one open question is settled, below), receiving invoices by e-mail, and on request the tax-office cross-check and the optional
kitchen screen and printer.

**Still open with you** (Part 4): a night-time freezer alarm would only be seen when someone opens the app, because alerts stay inside
the app; that has to be decided again with you before any sensor pilot. Before go-live: the placeholder portion for per-etto dishes.

Several answers depend on people outside DigiAlto: **the venue's accountant** (VAT, the accountant file, the tax-office check, how
per-etto sales are priced and rounded), **the venue's food-safety (HACCP) consultant** (what counts as a valid register or temperature
record) and **whoever advises the venue on data protection (to identify)** (personal-data points, with the data processing agreement,
DPA-1). This proposal does not state what the law requires; those points are marked for them.

---

## Founder decisions 2026-11-11

Answers given by the founder on 2026-11-11 to the decisions D1–D10 (Part 4). "Default, founder may revisit" means the founder accepted
the recommended default without objection and may change it later.

| # | Decision | Founder answer 2026-11-11 | Status |
|---|---|---|---|
| D1 | Phase 2 order | Accepted as proposed: P2-0 → P2-5 | Decided. "Sell by weight" (D10) is added after it as P2-6, without changing the accepted order (Part 3) |
| D2 | TOTP recovery and owner enrolment | Recommended default accepted (backup TOTP factor plus an audited reset by the other admin or owner account; owner offered, not forced) | Default, founder may revisit |
| D3 | May alerts leave the app? | **No.** The 2026-10-23 decision (ADR-006, in-app only) stands: no Telegram and no e-mail alerts. P2-4 becomes "full alert rules engine, in-app only" | Decided. Telegram (project M26, project plan V1) and e-mail alerts: **not in scope (founder 2026-11-11)** |
| D4 | Label printer, print path and timing | Recommended default accepted (QL-820NWBc after the supervised run and a device test; print from the phone; no bridge unless the test fails) | Default, founder may revisit |
| D5 | Temperature sensors | **Later, after P2-4, as a pilot once the venue's HACCP consultant confirms** how automatic records fit their manual | Decided (timing and condition). The alarm-visibility consequence is **open question OQ-1** (Part 4), not a decision |
| D6 | What the accountant needs | Recommended default accepted (invoice CSV with VAT per rate first; read-only login only if the accountant asks) | Default, founder may revisit |
| D7 | AdE corrispettivi cross-check | Recommended default accepted (parked until the accountant identifies the file and who downloads it; tax-portal credentials never stored) | Default, founder may revisit |
| D8 | Extra invoice intake | Recommended default accepted (e-mail-in later, after the domain and Resend exist; the Drive folder watch is dropped) | Default, founder may revisit |
| D9 | Reservations variants | Recommended default accepted (V2 yes, counts only; V1 stays "no"; V3, V5, V6 defaults kept) | Default, founder may revisit |
| D10 | Dishes sold per etto | **Weight sales go in Phase 2** (new candidate C17, step P2-6). Before go-live, how per-etto dishes are rung up until then is **open question OQ-2**, default: a fixed placeholder portion agreed with the chef | Decided (Phase 2); OQ-2 open before go-live |

---

## Part 2 — Detail

### 2.1 How to read the candidates

**Size (relative only, no days or prices):**
- **S** — a few commits; fits inside another milestone; no new provider, no new hardware, at most one small table or procedure.
- **M** — one normal milestone (one `/feature` run): new tables or procedures, screens and tests, no hardware.
- **L** — a large milestone, or one that needs hardware on site, a new external provider or account, or a spike before it can be
  planned, or one that changes several pinned core procedures at once. May split into two `/feature` runs.

**Invariant tags** (project plan §3.6 and `CLAUDE.md` rule 6). A candidate "touches" an invariant when its design must take care not
to break it:
- **[LEDGER]** stock and portion balances only derived; ledgers append-only, nothing deleted, only reversed (ADR-002).
- **[TXN]** procedures are single transactions.
- **[FROZEN]** recipes are immutable versions; costs are frozen at production and at sale.
- **[RLS]** every table has `tenant_id` and RLS; roles enforced in Postgres, not only in the UI.
- **[COST]** waiters never see costs (and the chef sees no € costs, ADR-006 context).
- **[API]** every screen reads `/api/*` JSON; no data logic in React.
- **[MODEL]** the extraction model ID only from `EXTRACTION_MODEL_ID`.
- **[SECRET]** the Supabase secret key only in `/api/cron/*`, `scripts/` and `src/server/staff-auth/privileged.ts` (`CLAUDE.md` rule 2).

**Where secrets live** (applies to every candidate below): application secrets in Vercel environment variables (per environment),
database-side secrets in Supabase Vault (`docs/guides/cron-vault-secrets.md`), CI secrets in GitHub environments, and every provider
login (Resend, sensor vendor cloud, tunnel provider, CAPTCHA provider, the accountant's own login) in the account owners' password
manager decided under Q26. Never in the repo; `.env.example` holds names with fake values. No alert-channel secret is planned (D3).

**Existing milestone numbers.** The project plan reserved M26–M40 for Phase 2 (§5a.4). Candidates keep those numbers where they exist.
New candidates (TOTP, temperature, sell by weight) get a number when the founder schedules them, to avoid clashes with branches in
flight. Project M26 (Telegram channel) is not in scope (founder 2026-11-11).

### 2.2 Current state (what Phase 2 builds on)

- `main` holds M0–M25c and A5. In flight, in the order the founder set on 2026-11-08: (a) A5b raw stock on the business day
  (`fix/a5-raw-stock-business-day`, ADR-033), (b) invoice-file backups (`feat/backup-invoice-files`, ADR-034), then reservations PR2
  (`feat/reservations-public`, ADR-032). Reservations PR1 is merged (latest migration on main per A5b: `20261124100650`).
- **Alerts are in-app only.** ADR-006: founder decision 2026-10-23, no e-mail, no third-party processor; the owner reads `/avvisi`.
  Reconfirmed by the founder on 2026-11-11 (D3). M16 rules (prep, purchase, expiry, low stock) run hourly through
  `app.run_alert_rules()`.
- **Labels exist as text only** (M14 label text; PRD 2.2 "manual label text in MVP"). Lots are captured on invoice lines when printed
  or typed at review (M4); `batch_input` links batches to raw lots (M14); firing links plates to batches (M19).
- **Order quantities:** whole portions plus half portions and shared plates (Q7, M18). No sale by weight (M17 Q71 default "no").
- **Exports:** every report as CSV and a monthly pack (M24, ADR-027). The CSV format is a default (Q170) not yet confirmed by the
  accountant. No invoice-with-VAT export, no accountant role.
- **Forecast:** MVP trailing 4-week weekday average on the push/forecast panel (M23). Push history is logged in `menu_push` (ADR-026).
- **Kitchen screen:** chronological ticket list with "Fatto" and comanda close (M19, M19b, ADR-024). No printer.
- **Sign-in:** owner and admin by e-mail/password with an e-mail code fallback (ADR-029); staff by PIN on enrolled devices (ADR-010).
  No second factor (RISK-1 accepted 2026-11-08). `supabase/config.toml` has `[auth.mfa.totp]` enroll and verify off (M25a).
- **Hosting decided 2026-11-08:** Vercel Pro for production; production Supabase on Free (Q187, closeout §2 Q10).

---

### 2.3 Candidates

Each candidate: value · size · dependencies · risks · founder questions · invariants touched.

#### C1. TOTP second factor (admin required, owner optional) — founder decision 2026-11-08: early in Phase 2, after go-live

- **Source of the decision:** `docs/go-live/phase1-closeout.md` — "an early Phase 2 item after go-live" and "TOTP comes after go-live".
  Putting it **first** in the Phase 2 order (Part 3) is this proposal's recommendation, not the founder's decision.
- **Status 2026-11-11:** the order with C1 as P2-1 accepted (D1); the D2 recovery default accepted (default, founder may revisit).
- **Value:** a stolen password alone no longer opens the admin or owner account, which see every cost and can change master data.
- **Size:** M.
- **Design sketch:** Supabase Auth TOTP (enroll, challenge, verify); the access token's assurance level (`aal`) is checked
  **in Postgres** for the admin (a restrictive policy / role-gate helper alongside `app.role()`), not only in `withApi`, so the
  "roles enforced in Postgres" rule holds. Owner: enrolment offered, and once enrolled, required at every sign-in. Staff PIN
  sessions unchanged. Project M11 V9 (never built) is the starting point.
- **Dependencies:** TOTP is available on the production plan (Free). Founder step M-6 is settled: Supabase's TOTP guide
  (https://supabase.com/docs/guides/auth/auth-mfa/totp, read by the lead on 2026-11-11) says "TOTP MFA API is free to use and is
  enabled on all Supabase projects by default". The older CLI template comment on `config.toml` that says Pro (M25a T7) is superseded
  by that page. Supabase has no built-in recovery codes; its docs recommend enrolling a second, backup TOTP factor (see D2). No new
  secret.
- **Risks:** lock-out when a phone is lost (recovery path needed, see questions); the e-mail-code fallback of ADR-029 must not bypass
  the second factor; the 30-day session cap of ADR-029 interacts with the `aal` level; Playwright needs a TOTP test helper. With no
  built-in recovery codes, recovery rests on a backup factor and an admin reset (D2); an admin reset is itself a sensitive action and
  must be limited to the other admin or owner account and audited.
  Folding in the small auth follow-ups F13 (PIN-change window) and F16 (money-guard gaps) is proposed, because they touch the same
  guards.
- **Founder questions:** recovery when the admin or owner loses the authenticator (recovery codes? reset by a second DigiAlto admin
  account? reset in the Supabase dashboard?); is the owner prompted to enrol or only offered it; passkeys (Face ID) in the same
  milestone or not (ADR-029 lists passkeys as "revisit with TOTP (Q204)").
- **Invariants:** [RLS] (aal check in Postgres), [SECRET] (no new secret-key use).

#### C2. Label printer with QR and scan-to-consume (project M28, M30; bridge M29)

- **Status 2026-11-11:** D4 default accepted (default, founder may revisit): QL-820NWBc after the supervised run and a device test;
  print from the phone; bridge only if the test fails.
- **Value:** every batch and decanted raw item carries a printed use-by, lot and QR; scanning it opens the batch to consume, discard,
  count or reprint, with no typing — the PRD's "the label is the document".
- **Size:** L as a whole (hardware on site and a device test). Split: M28 label rendering + AirPrint path (M), M30 scan-to-act (M).
  The bridge (M29) only as a fallback variant (L).
- **Bridge vs AirPrint:**
  - **PRD design:** Raspberry Pi Zero 2 W running `brother_ql_web` in Docker behind an outbound tunnel; AirPrint from the phone when
    the bridge is absent.
  - **Research (2026-11-05) recommends the opposite default:** the app renders an exact-size label page or PDF and the phone's own
    print dialog sends it (AirPrint on iOS, Brother Print Service Plugin on Android). No bridge, no SDK. A Vercel-hosted app cannot
    reach a printer on the venue LAN, and iOS Safari has no Web Bluetooth/WebUSB.
  - **Proposed (accepted as default):** AirPrint-first. The bridge becomes a variant triggered only if the device test fails. Reason:
    `CLAUDE.md` says "nothing is hosted at the venue"; a Pi adds a device to patch, a tunnel provider account and a token stored on a
    box in the kitchen.
- **Hardware (research, prices as of research date 2026-11-05, capture date unknown):**
  - **Brother QL-820NWBc** (primary): Amazon.it €196.99 (QL-820NWBcVM), €230.48 (sold by Amazon), €266.96 (older QL820NWB SKU);
    Trovaprezzi from €188.88. Wi-Fi, Ethernet, Bluetooth, USB; AirPrint yes; Android via Brother Print Service Plugin; Mopria
    certification **unverified**.
  - Brother QL-810Wc (budget, Wi-Fi only, no Ethernet): Unieuro €129, PcComponentes €159.99, Bechtle €110.99–133.99; Amazon.it
    **unverified**.
  - Media: DK-11209 29×62 mm die-cut about €13–13.69 per roll of 800 (Amazon.it price **unverified**); DK-22205 roll price in Italy
    not found; cost per label for continuous rolls **unverified**.
- **Dependencies:** printer purchase (founder/client), which the PRD places after the two-week supervised run (PRD Roadmap: "nothing is
  bought until the loop has run for two weeks under supervision"; Gate 4: "decision on label printer purchase"); venue Wi-Fi or a
  wired port at the router; label size chosen (62×29 die-cut or 62 mm continuous); the PRD's operator initials on the label put staff
  initials on paper — whether that counts as personal data needing a note in the staff register is **to confirm with the venue's
  data-protection adviser / DPA-1**.
- **Risks (research):** AirPrint printed ~6× too large after an iPadOS update; roll size may not match the AirPrint paper list; scale
  must be 100 %; whether `window.print()` works inside an installed iOS Home-Screen PWA is **unverified** (keep "open PDF → share →
  Print"). Direct-thermal paper labels' adhesive failed on thawing in an independent test: freezer items need DK film or freezer-grade
  labels, tested first. QR scanning opens a URL into the PWA: it must resolve only for the signed-in tenant (another tenant's id → 404,
  project M30 test), and a scan from a waiter must not expose batch cost.
- **Founder questions:** buy the QL-820NWBc (or the cheaper QL-810Wc)? Who prints (chef only, or also the owner)? May a waiter scan a
  label (to consume) or only the chef? Freezer labels needed? Decant labels for raw items from day one?
- **Invariants:** [LEDGER] [TXN] (scan-to-consume/discard must call the existing M15 procedures, never write movements directly),
  [RLS] (QR → tenant-scoped lookup), [COST] (scan view for non-owner roles carries no € fields), [API].

#### C3. Full lot traceability, invoice → batch → plate (project M31, first half)

- **Value:** in a supplier recall, one screen lists every batch made from that lot and every plate served from it, with times; and the
  reverse from a batch to its suppliers.
- **Size:** M. The links already exist (`raw_lot`, `batch_input`, `batch_movement`, order lines); this is read-only reporting plus
  optional lot photo at receiving.
- **Dependencies:** lots are only as good as their capture: printed on the invoice, or typed at review (optional today). Encouraging
  capture (PRD: "encouraged in Phase 2") is a process change for the owner. A lot photo adds files to the `invoices`-style storage
  and to the backup (ADR-034; Free file-storage limit is Q-F1).
- **Risks:** plates fired from "senza lotto" stock (unlotted shortfall, ADR-011) or negative stock (plan §3.6 rule 8) have no lot:
  the trace must show the gap honestly, not guess. Existing rows cannot be corrected in place, because nothing is deleted or updated,
  only reversed (plan §3.6 rule 5). Once C17 ships, a weight line traces like any other line (it depletes the same batches).
- **Founder questions:** is lot capture at receiving to become required for some ingredient categories? Is a lot photo wanted
  (storage, retention)?
- **Invariants:** [LEDGER] (read-only over ledgers), [RLS], [COST] (chef view without €), [API].

#### C4. HACCP registers: secondary labels, lot register, non-conformity log (project M31, second half)

- **Value:** the records the kitchen keeps by hand for inspections come out of data the app already holds.
- **Size:** M (after C2 and C3: secondary-label records need printed labels; the lot register is C3's data; the non-conformity log is
  waste with reason, M15).
- **Dependencies:** C2, C3; the venue's *manuale di autocontrollo* and HACCP consultant.
- **Risks / legal:** whether an app register replaces or supplements the paper registers, which fields it needs and how long it is
  kept are **for the venue's HACCP consultant to confirm**; this proposal makes no legal claim. The non-conformity log needs a
  "corrective action" field that waste rows do not have today.
- **Founder questions:** may we ask the venue's HACCP consultant which registers and fields their manual expects? Printable
  (PDF) register per month?
- **Invariants:** [LEDGER] (corrective actions as new append-only rows, not edits to waste), [RLS], [API].

#### C5. HACCP temperature logging (Shelly vs UbiBot) — raised by the founder; **scope change**

- **Status 2026-11-11 (D5):** later, **after P2-4**, as a **pilot once the venue's HACCP consultant confirms** how automatic records
  fit their manual. Before any pilot, **open question OQ-1** must be re-decided with the founder (below and Part 4).
- **Value:** fridge and freezer temperatures recorded automatically, with an in-app alert when one goes out of range or stops
  reporting.
- **Scope note:** the PRD and project plan §1.4 put temperature logs **out of scope** ("unless a cheap sensor option is wanted
  later"). The founder's D5 answer brings a later pilot into Phase 2; the lead records the scope change in DigiAlto-Ops `context.md`.
- **Size:** L (hardware on site, possibly an electrician, a new public ingest path, a new ADR).
- **Options (research, prices as of research date 2026-11-05, capture date unknown):**
  - **Shelly 1 Gen3 + Shelly Plus Add-on + DS18B20 probes** (research primary): Shelly 1 Gen3 €12.60 (list €14), Plus Add-on €11.90
    (list €17) on shelly.com/it; DS18B20 probe €3.75; Amazon.it **unverified**. Research's parts total for its example of 2 fridges +
    1 freezer + optional blast chiller: about €64–77, plus 12 V adapters or a 230 V wiring job (price and labour **unverified**).
    Pushes readings straight to our HTTPS route (webhook or device script); **no buffering** when Wi-Fi drops; DS18B20 ±0.5 °C only
    from −10 to +85 °C, ±2 °C over the full range (so ±2 °C at −18 °C); no calibration certificate; DIY assembly.
  - **UbiBot WS1 Pro + DS18B20 probe** (research "turnkey"): $89.99 (official store, inconsistent pages), €103.25 ex VAT (Botland,
    discontinued listing); Amazon.it **unverified**; research estimate about €100 each, about €400 for 4, price **unverified** in Italy.
    Vendor cloud account; "Channel Data Forwarding" POSTs JSON to our URL and must get `SUCCESS` within 15 s; **buffers readings and
    syncs after an outage**; free plan and forwarding credits per the vendor's pricing page (research cites a Bronze plan at $15/month
    — not verified by us, founder to check).
  - Research also lists a no-wiring budget mix (SwitchBot meters + a Shelly probe set for the freezer). Not proposed as default.
- **Design implications (research Part C):** append-only `temperature_readings` ledger; per-device token; a Zod-validated,
  rate-limited ingest endpoint; **needs an ADR** because ingest must not use the secret key outside the allowed paths ([SECRET]):
  e.g. a `SECURITY DEFINER` RPC that checks the device token, or a Supabase Edge Function. Shelly webhooks carry the token in the URL,
  so URLs must never be logged. pg_cron every few minutes raises an in-app alert (through the P2-4 rules engine) on out-of-range
  **and on missing data**. A daily sheet per appliance (min/max, events, corrective action, who checked).
- **Dependencies:** P2-4 (rules engine, in-app); the HACCP consultant's confirmation (D5); **OQ-1**: alerts stay in the app (D3), so a
  night-time freezer alarm would only be seen when someone opens the app; that consequence must be re-decided with the founder before
  any sensor pilot. (Web Push on iOS works only for Home-Screen-installed apps, research [52]; it would be an outbound channel, which
  D3 rules out unless the founder re-decides.) Venue Wi-Fi in the kitchen; mains or 12 V at each appliance; for UbiBot, a vendor
  account and its DPA/retention.
- **Risks / legal:** consumer sensors are not certified; research notes recorders for quick-frozen food are "normally expected" to
  meet EN 12830 and that how Reg. (CE) 37/2005 applies to restaurant freezers was **not confirmed**; no fixed legal logging frequency
  was found. **All of this is for the venue's HACCP consultant to confirm.** Keep a paper fallback when a sensor is offline. A
  certified reference logger to check sensors periodically is a research *suggestion*, not a found requirement. An unseen night
  alarm (OQ-1) means the record exists but nobody acts on it in time.
- **Founder questions:** OQ-1 (above). Shelly (cheaper, DIY, no buffering, no vendor cloud) or UbiBot (buffering, vendor cloud and its
  pricing/retention/DPA)? How many cold points and which appliances (not a client fact today)? Will the consultant accept automatic
  records as part of the manual?
- **Invariants:** [LEDGER] (readings append-only), [RLS] (readings per tenant; ingest resolves tenant from the device token, never from
  the payload), [SECRET], [API].

#### C6. Demand forecast with prep list and order guide (project M32, M33)

- **Value:** the chef gets a suggested list of batches to make and the owner a suggested order per supplier with order-by times,
  with an accuracy figure (MAPE per dish) showing whether to trust it.
- **Size:** L (two milestones: model + MAPE backtest; prep list/checklist + order guide).
- **Dependencies:** **real sales history** after go-live — how many weeks are enough is a question, not assumed; supplier lead times
  and delivery days (Q3, filled during setup); weather from open-meteo (PRD calls it free; its terms for commercial use and any key
  are **to verify at plan time**); the weather location needs the venue's coordinates or address, which is **not an approved client
  fact**; the "local events" flag needs someone to enter events. Per-etto dishes sold as placeholder portions (OQ-2) until C17 ships
  give a distorted history for those dishes.
- **Risks:** a model trained on few weeks shows a high MAPE and loses the chef's trust; the purchase rule must keep the MVP average
  as fallback; forecast panel accessibility follow-up F36 folds in here.
- **Founder questions:** how many weeks of sales before switching on; may the venue's location be used for weather; who enters local
  events; should accepting the order guide create anything outside the app (no — purchase orders are Phase 3, M45)?
- **Invariants:** [COST] (prep list for the chef without €), [RLS], [API]; [TXN] when accepting a prep list writes checklist rows.

#### C7. Menu engineering matrix and supplier price benchmarking (project M34)

- **Value:** a 2×2 of popularity against contribution per dish (stars, plowhorses, puzzles, dogs) with a suggested action; and which
  supplier has been cheapest for the same ingredient.
- **Size:** M. Mostly reads M22 KPIs (contribution by item already exists) and `price_history`.
- **Dependencies:** enough weeks of sales for stable mix %; fixed costs entered (Q4) if contribution uses full cost; how C17 counts a
  weight line in "plates sold" and mix %.
- **Risks:** "supplier price benchmarking" is ambiguous: comparing **this venue's own suppliers** from its own price history is
  in-tenant; comparing against **other tenants or market prices** would break tenant isolation or need an external data source. The
  proposal assumes own-history only. Pack-size normalisation must use the M1 conversions or the comparison is wrong. The breakdown
  status follow-up F10 (fixed cost missing from the newer badge) folds in here.
- **Founder questions:** own-supplier comparison only (proposed), or an external price source? Does the chef see the matrix (in % only)?
- **Invariants:** [COST] (owner/admin € view; chef % only; waiters none), [RLS] (no cross-tenant data), [API].

#### C8. AdE corrispettivi import as a cross-check (project M35)

- **Status 2026-11-11:** D7 default accepted (default, founder may revisit): **parked** until the accountant identifies the file and
  who downloads it; the venue's tax-portal credentials are never stored.
- **Value:** the app's daily sales compared with what the fiscal register reported to the tax office, so gaps show without retyping.
- **Size:** L (unknown input format; a spike first).
- **Dependencies:** what file can be obtained, from where (the tax office's portal, the RCH back office, or the accountant), in which
  format, and who downloads it — **none known**. Proposed path: the owner or accountant uploads the file.
- **Risks / legal:** what the corrispettivi data means, how it aligns with the business day (cut-off, ADR-033), and how fatture are
  treated (M21 Q130) are **for the venue's accountant to confirm**; no legal or fiscal claim is made here. Overlaps the existing
  end-of-day register total (M21), which already gives an app-vs-register variance.
- **Founder questions:** does the accountant already receive this data, and in which file? Is the M21 manual register total enough for
  now?
- **Invariants:** [LEDGER] (imported fiscal totals append-only, never overwrite day close), [RLS], [API].

#### C9. Full alert rules engine, in-app only (project M27)

- **Status 2026-11-11 (D3):** the founder's 2026-10-23 decision stands (ADR-006, in-app only). The outbound channel half of the
  original candidate — Telegram (project M26 and project plan variant V1) and e-mail alerts — is **not in scope (founder 2026-11-11)**.
  ADR-006 needs no change.
- **Value:** thresholds and audiences of the alert rules become tenant settings the owner can adjust, instead of values fixed in code;
  alerts keep arriving in `/avvisi` with one-tap acknowledge, as today.
- **Size:** M.
- **Dependencies:** none external; no new provider, no new secret. Builds on `app.raise_alert`, the kind registry and the replaceable
  `app.alert_rules_body()` of ADR-006 and the M16 rules.
- **Risks:** alerts are seen only when someone opens the app (ADR-006's accepted trade-off, reconfirmed by D3) — this matters most for
  C5 (OQ-1); once rules become data, one failing rule still rolls back that hour's whole rule body unless per-rule isolation is added
  (ADR-006 rejected a registry "for now"; this milestone is where to revisit it); the M16 dedup and the Postgres guards (no chef in a
  cost-bearing kind, no money keys in non-cost payloads) must hold for rules defined in data. Job-health follow-up F7 folds in here.
- **Founder questions:** which rules must be configurable (proposal: thresholds and audiences, not new rule types)? Who may change
  them (proposal: owner and admin, audited, like M8 Q10/Q11)?
- **Invariants:** [COST] (audience guard and payload money guard stay), [RLS] (rules are tenant data), [TXN] (rule changes audited in
  the same transaction), [API].

#### C10. Accountant CSV export and read-only role (project M36)

- **Status 2026-11-11:** D6 default accepted (default, founder may revisit): the invoice CSV first; the read-only role only if the
  accountant asks for a login.
- **Value:** the accountant gets approved invoices with the VAT split per rate without asking the owner.
- **Size:** M (export S on top of M24; the role is the bigger half because every RLS policy and pgTAP role matrix gains a role).
- **Dependencies:** the CSV format and gross/net conventions (Q20, Q170) **confirmed by the venue's accountant**; who the accountant is
  and their e-mail are **not client facts** today; giving an external person a login is a data-protection point **to confirm with the
  venue's data-protection adviser (to identify) / DPA-1** (DPA, records entry).
- **Risks:** a read-only role that can read invoice prices but must not write anything; the role matrix test (plan §3.11.2) and the
  waiter-cost column test must be extended; the accountant must not see staff data or alerts.
- **Founder questions:** does the accountant want a login, or is a monthly CSV sent by the owner enough (then the role is not needed)?
  Which columns and format? Does the accountant also need the monthly pack?
- **Invariants:** [RLS] (new role in Postgres policies), [COST] (accountant sees invoice prices but not recipe costs — confirm), [API].

#### C11. E-mail-in invoices (Resend inbound) (project M37)

- **Status 2026-11-11:** D8 default accepted (default, founder may revisit): e-mail-in later, after the domain and the Resend account
  exist; the Google Drive folder watch (M10) is dropped. (This is invoice intake, not alerts; D3 does not affect it.)
- **Value:** a supplier or the owner forwards an invoice PDF to an address and it lands in review, as an alternative to photographing it.
- **Size:** M.
- **Dependencies:** Resend account (S8-3) with a receiving domain (Q12/Q188: domain not decided); inbound webhook signing secret in
  Vercel env; Resend's inbound behaviour, payload and retention of received mail **to be checked in Resend's docs at plan time** (not
  verified here; reservations T-R2 already notes resend.com was unreachable from these sessions).
- **Risks:** anyone can send mail: sender allow-list (project M37 test), size and type checks of M2 (4 MiB bucket limit, magic bytes),
  and the extraction prompt-injection guard (plan §3.11.5) apply unchanged; more files against the Free storage limit (ADR-034 context,
  Q-F1) and the backup. Upload hardening F15, orphan-object listing F19 and the review polish F31–F32 fold in here. Whether sender
  addresses (e.g. sole-trader suppliers) are personal data and how long they are kept is **to confirm with the venue's data-protection adviser (to identify)
  / DPA-1** (project Q13 asks the same about sole-trader suppliers).
- **Founder questions:** which senders are allowed? How long are received mails kept at the provider (provider prices and retention
  are open, not estimated)?
- **Invariants:** [MODEL] (same extraction path, model ID from env), [RLS] (tenant from the receiving address, never from the mail),
  [SECRET] (intake processing in a cron route or a privileged path decided by ADR).

#### C12. Push-list sell-through (project M38)

- **Value:** the owner sees how many of yesterday's pushed portions actually sold, and learns which pushes work.
- **Size:** S. Reads `menu_push` (ADR-026) and fired order lines; M23 already reports discards vs push.
- **Dependencies:** none external.
- **Risks:** define "sold" (fired, not voided) and the business day (ADR-033) the same way M22 does.
- **Founder questions:** sell-through in portions, %, or both? Chef sees it?
- **Invariants:** [COST] (no € to the chef), [API].

#### C13. Optional: KDS and ESC/POS kitchen printer (project M40)

- **Value:** a kitchen that prefers paper gets a ticket per course; a bump bar marks dishes done without touching a screen.
- **Size:** KDS improvements S–M (the M19/M19b ticket list with "Fatto" already is a KDS); ESC/POS printer L.
- **Dependencies:** an ESC/POS printer on the LAN needs something on site to receive jobs (the same bridge problem as C2: a cloud app
  cannot reach the LAN). Whether a specific printer can pull jobs from a cloud URL by itself is **unverified** (not researched). Bump
  bar hardware and how it talks to a browser **not researched**. No hardware prices are given here (outside the 2026-11-05 research).
- **Risks:** a venue box contradicts "nothing hosted at the venue"; printing must be idempotent (a fired course prints once, project
  M40 test).
- **Founder questions:** does the kitchen want paper at all after the supervised run? If yes, research the printer first.
- **Invariants:** [COST] (tickets carry no costs), [API].

#### C14. Reservations variants V1–V6 (`docs/plans/2026-11-08-reservations.md` §5b)

**Status 2026-11-11:** D9 default accepted (default, founder may revisit): V2 yes (in P2-2); V1 stays "no"; V3, V5 and V6 keep their
defaults; V4 is done.

Shared context: reservations are the first customer personal data in the app (reservations plan, "Flags for the founder"); every
variant keeps [RLS] (personal data only for owner/admin/waiter; chef 0 rows) and [API]. Variant IDs below are the reservations plan's.
The reservation e-mails to customers (PR2, and V6) are booking confirmations, not staff alerts; D3 does not affect them.

**C14-V1. Waiters accept and decline**
- **Status:** Q-R1 **answered "no" by the founder on 2026-11-08** (owner and admin only); kept under D9.
- **Value:** faster replies to online requests when the owner is busy.
- **Size:** S (two steps, V1.1–V1.2).
- **Dependencies:** a founder re-decision on Q-R1; nothing external.
- **Risks:** waiters gain a write action on customer-facing outcomes (accept/decline e-mails are sent in the venue's name); `move`,
  `assign`, `erase` and settings must stay owner/admin (V1.1 test).
- **Founder questions:** keep "no"? If requests wait too long during service, revisit?
- **Invariants:** [RLS] (role gate widened in Postgres, `require_table_operator()`).
- **Proposal:** keep the founder's answer.

**C14-V2. Chef sees covers per service (no personal data)**
- **Status:** **accepted under D9** (default, founder may revisit); in P2-2. Q-R2's default "no access" is replaced by "counts only".
- **Value:** the chef plans prep from booked covers; also a future input for C6.
- **Size:** S (V2.1–V2.2).
- **Dependencies:** none external; reservations PR1 (staff side, merged); V2 extends its steps A6, A9 and A12 and the chef's production screen.
- **Risks:** a leak of names, phones or e-mails into a chef payload; guarded by the plan's `/name|phone|email/` key test and the chef
  still reading 0 rows from the reservation tables.
- **Founder questions:** on the production screen only?
- **Invariants:** [RLS], [COST] (counts carry no money), [API].
- **Proposal:** in P2-2.

**C14-V3. CAPTCHA (Cloudflare Turnstile)**
- **Status:** Q-R7 default (honeypot, fill time, daily limits, pending cap, no CAPTCHA) accepted by the lead; kept under D9.
- **Value:** stops bot spam on the public booking page.
- **Size:** S (V3.1–V3.2).
- **Dependencies:** a new provider: **its terms and prices** (not estimated) accepted by the founder; site key and
  `TURNSTILE_SECRET_KEY` in Vercel env; the provider named in the privacy notice (Q-R12); the CSP opened for the provider on
  `/prenota/*` only (ADR-028).
- **Risks:** a third-party script and sub-processor on a public page (DPA-1 update, **to confirm with the venue's data-protection adviser (to identify)**);
  provider outage → 503 on requests; the verification API is taken from the provider's docs at build time, not assumed.
- **Founder questions:** only if spam appears in practice? Which provider, after reading its terms?
- **Invariants:** [SECRET] (secret only server-side, never in errors), [API].
- **Proposal:** only on evidence of spam.

**C14-V4. Combined tables locked in Sala**
- **Status:** **answered 2026-11-08 and folded into PR1** (reservations plan §5c, with a split action).
- **Value / size / dependencies / risks:** delivered; nothing left for Phase 2.
- **Founder questions:** none.
- **Proposal:** done.

**C14-V5. Tenant by host name**
- **Status:** Q-R3 default (`<app domain>/prenota/<slug>`) accepted by the lead; kept under D9.
- **Value:** a booking address of its own (e.g. `prenota.<domain>`).
- **Size:** S (V5.1–V5.2).
- **Dependencies:** **Q-R15** — the custom app domain and DNS access; the domain itself is not decided (Q12/Q188) and the venue's
  domains are not an approved client fact.
- **Risks:** host-header handling in the proxy: staff paths on the public host must answer 404 (V5.2 test); tenant resolution from
  the host must never mix with a slug of another tenant (V5.1 test).
- **Founder questions:** is a separate booking host wanted once the domain exists?
- **Invariants:** [RLS] (tenant resolved server-side from a unique host), [API].
- **Proposal:** only after Q-R15 is answered; otherwise keep the path.

**C14-V6. E-mail when staff move a booking**
- **Status:** Q-R9 default (no e-mail on a move; staff call the customer) accepted by the lead; kept under D9.
- **Value:** the customer learns the new time without a phone call.
- **Size:** S (V6.1–V6.2).
- **Dependencies:** the Resend sending path of reservations PR2 live in production (the Resend account (S8-3) and Q-R14 (prices, retention, data location) open; Q-R15
  sending domain).
- **Risks:** more customer e-mail through a sub-processor; a wrong move sends a wrong time (staff can move again, which sends again).
- **Founder questions:** after the first weeks of real bookings, do staff want this?
- **Invariants:** [RLS], [TXN] (the `moved` outbox row written in the same transaction as the move), [API].
- **Proposal:** keep the default; revisit with real use.

#### C15. Waiter "Pronto" on dishes (closeout follow-up, M19b V1 deferred)

- **Value:** the waiter sees when a dish is ready at the pass. **Size:** M. **Dependencies:** none. **Risks:** a second polling
  consumer (ADR-024). **Question:** wanted after the supervised run? **Invariants:** [COST], [API].

#### C16. Allergen matrix (project Q21, not phased)

- **Value:** allergens per dish derived from ingredients, printable for the menu.
- **Size:** M.
- **Dependencies:** chef answers A-01…A-22 (`docs/client/`, draft, not approved facts).
- **Risks:** a wrong or incomplete allergen shown to customers; ingredient allergens are captured from M1 but an imported list never
  counts as confirmed (M7 Q2), so the matrix must show "not confirmed" honestly; supplier recipe changes can change allergens.
  **Legal:** the PRD cites EU 1169/2011; what the venue must display is **for its consultant to confirm**.
- **Founder questions:** which phase? Who confirms each dish's allergens before they are printed?
- **Invariants:** [API]; recipes immutable (derive per version).

#### C17. Sell by weight (per etto) — founder decision 2026-11-11 (D10): Phase 2

- **Status:** decided for Phase 2 (D10); proposed as step **P2-6** (Part 3). Until it ships, per-etto dishes are rung up as a fixed
  placeholder portion agreed with the chef (**OQ-2**, before go-live).
- **Value:** dishes the menu prices per etto are sold as weighed: the bill shows the right price and the stock goes down by what was
  actually served, instead of a placeholder portion that distorts revenue, depletion, food cost % and every report built on them.
- **Design sketch:**
  - A menu item can be flagged "sold by weight" with a **price per etto** (a sale price, kept in the append-only menu price history of
    ADR-016) and a **reference portion weight in grams** (the weight that equals one portion of its recipe).
  - Staff enter **grams** on the order line. The line's **sale price = price per etto × grams ÷ 100**, computed in SQL like the rest of
    the bill (ADR-023); the rounding rule is a founder/accountant question, not assumed.
  - **Depletion is proportional:** the line depletes `grams ÷ reference portion weight` portions (a fraction, as half portions already
    deplete 0.5, Q7) from the FEFO batches, and its direct raw ingredients scale by the same fraction, inside `fire_course`.
  - **Cost frozen at sale:** the line's frozen cost is the same fraction of the plate's frozen unit cost, written once when the line
    is fired, never recomputed.
  - **Waiters see no cost:** the waiter sees the per-etto menu price (already visible today) and the line's computed sale price; no cost,
    margin or frozen-cost field enters any waiter payload or the offline cache.
- **Size:** L. No hardware or provider, but it changes the menu item, the order-line quantity rule, `add_order_line`,
  `update_order_line`, `fire_course`, `void_line`, the bill and day-close totals, the KPI and export definitions of "plates sold" and
  mix, and the offline op schema — several of them pinned procedures that must be re-pinned on purpose, with every existing M17–M24
  case staying green.
- **Dependencies:** which dishes are per etto, their prices and their reference portion weights — the draft menu lists per-etto items
  but they are **not approved client facts** (`docs/client/menu-draft.md`, DRAFT), so the chef and founder must confirm them; how the
  cashier keys a weighed dish into the RCH register (outside the app, but the receipt must match) and the price rounding rule — **for
  the venue's accountant to confirm**; whether staff weigh at the pass and who types the grams (waiter or chef). A Bluetooth scale is
  optional Phase 3 hardware in the PRD (Android only) and is **not** assumed here: grams are typed.
- **Risks:**
  - money arithmetic: a per-etto price times grams gives fractions of a cent; the bill, split by covers (M21 Q134) and day-close totals
    must round once, in one place, and add up exactly (existing M21 split test extended);
  - a weight line where a portion count is expected: the "3 portions left" hint (M18 Q77), the sold-out block (PRD 3.2), push
    sell-through (C12) and KPIs "plates sold" and mix % (M22) must each define a weight line (proposed: its portion fraction, as for
    half portions) — a founder question;
  - voids: a void before firing restores nothing; after firing it becomes waste of the same fraction (ADR-019), at the frozen cost;
  - offline replay (ADR-022): the new field must keep every op replay-safe by entity id; otherwise it triggers ADR-022's "revisit";
  - typing errors (e.g. 1500 g for 150 g): an upper bound per line and a confirmation above it, values not assumed here;
  - the placeholder period (OQ-2) leaves per-etto sales recorded as fixed portions in the ledgers; those rows are not rewritten later
    (append-only), so reports before and after C17 differ for those dishes.
- **Founder questions:** which dishes and which reference portion weights (with the chef)? Who types the grams? Rounding of the line
  price (with the accountant)? How a weight line counts in "plates sold" and mix? An upper bound per line?
- **Invariants:** [FROZEN] (line cost frozen once at fire; per-etto price frozen on the line at order, as M18 Q79 does for prices),
  [COST] (no cost field to waiters or into the offline cache; extend the M0 waiter-cost column test), [LEDGER] (proportional depletion
  and voids as append-only movements; no balance stored), [TXN] (`fire_course` and `void_line` stay single transactions with the weight
  path inside them), [RLS], [API] (price computed in SQL, not in React).

---

### 2.4 Parked items

#### Offline follow-ups (founder: offline mode is low priority)

All parked in Phase 2 with no milestone, unless the supervised run shows frequent dead-entity stops or held ops (ADR-022 "what would
make us revisit this"). **IPHONE-1 is not parked**: the real-iPhone offline reload check stays a go-live checklist row.

| Item | Source | Parked note |
|---|---|---|
| G4 service-worker items: `AbortSignal.any`, concurrent puts, timer-clear test, 401 classed as network, `storedSeq` pruning, `warm-reads` rate limit | closeout §1; M25 §3.6 ("no data effect at one venue") | Parked |
| WebKit's service worker not driven by Playwright (T16) | M25 plan | Parked; covered manually by IPHONE-1 |
| AT6 offline tap branch (table opened offline via the cached shell) not covered by e2e | M20 plan line 685 | Parked |
| `applied_op` grows without a retention rule (Q120) | ADR-022, closeout §2 | Parked; decide with Q14 |
| Defaults Q117, Q118, Q119, Q121, Q122, Q123, Q124, Q125, M21 Q135 | closeout §2 | Triaged in §2.5.2 (Q121 → Phase 2 with the logo, Q124 → before go-live with the GDPR register, the rest kept) |
| Offline nonce replay (accepted risk 6 in the security walk) | closeout §0 | Accepted; check is IPHONE-1 |
| Role-gate questions: **a chef's offline copies stored before the role gate stay until the next login**; **lag between the role in the access token and the role in the `app_user` row** | PR #70 (offline-cache role gate, merged 2026-11-10), its two open questions | Source: PR #70's description. (1) A device where a chef used the app before the gate keeps that chef's stored `/api/me` copy until the next login, logout or demo purge on that device (each calls `forgetUser()`); deleting the read cache on every new worker version would also wipe the waiters' offline copies at each deploy, so it was not done. (2) `/api/me` follows the `app_user` row, while `/api/menu`, `/api/tables` and the order lines follow the token's role, so a waiter just made chef can still have those three stored until the token refreshes; they hold no costs. The lead accepted both as defaults at the #70 read; recommended group: keep as is |

#### Q-A5b-3 (from `docs/plans/2026-11-08-a5b-raw-stock-business-date.md`)

- **Question:** in the stock reconciliation, a count closed at 01:45 Monday belongs to Sunday's period but the row prints the date it
  was closed ("9 nov"); print the business date ("8 nov") instead?
- **Default in force:** no (keep the real date of the count). "Yes" → A5b V3.
- **Proposal:** keep as is; revisit if the owner finds the row confusing at UAT. Size S if wanted.

---

### 2.5 Phase 1 close-out triage (`docs/go-live/phase1-closeout.md`)

Four groups: **Before go-live** (must be done or answered before the production go-live) · **Phase 2** (scheduled or folded into a
Phase 2 milestone) · **Drop** (close the item: obsolete, superseded or answered in practice) · **Keep** (keep as is: the current
behaviour or default stays, no work planned, revisit only on evidence).

Section 3 of the close-out (founder and ops steps: checklist S8-*, AT*, G3-*, G7-*, FREE-*, DPA-1, runbook owners, manual steps) is
**not re-triaged**: those are go-live steps already marked blocking or not; this proposal does not change them.

#### 2.5.1 Open follow-ups (close-out §1) — F1–F52

F1–F52 are this document's own labels, assigned in the close-out's line order; the close-out does not number its follow-ups. G-numbers
(G3, G13, …) are the close-out's and M25 §3.6's own.

| # | Follow-up | Group | Reason |
|---|---|---|---|
| F1 | Raw stock still calendar-dated (A5b) | Before go-live | PR #50 says before go-live; in progress on `fix/a5-raw-stock-business-day` |
| F2 | Drop the unused index | Before go-live | A5b drops `batch_movement_effective_idx` (in its scope); it keeps `stock_movement_effective_idx` (still read by `app.kpi_purchases`), which is dropped only under A5b V1 |
| F3 | G13 KPI register line mixes all-dates app total with dated difference | Phase 2 | M25 §3.6: "Gate 3 reads single days", so the go-live gate is unaffected; scheduled "After go-live (flagged to the founder)" |
| F4 | G14 KPI rollup can race `purge_demo_data` | Keep | Purge runs only on a demo-flagged tenant; production has no demo data (A3) |
| F5 | G8 staff-meal rule at a deactivated location | Keep | Runbook workaround exists; rare |
| F6 | G3 monthly pack reads ≤ 12 counts / 10 pages | Phase 2 | Only bites after many monthly counts |
| F7 | Job-health does not read `cron.job_run_details` | Phase 2 | Fold into C9 (rules engine, in-app); more scheduled rules make silent timeouts costlier |
| F8 | M13 known limits (cost lock in `count_close`, same-day manual run, job never writing `job_run`) | Keep | Accepted limits with no data loss |
| F9 | `purchasesUnvaluedCount` always 0 | Drop | Receipts never carry a null cost; nothing to fix |
| F10 | Breakdown status excludes fixed cost | Phase 2 | Two badges disagree; fold into C7, which reads the same output |
| F11 | Stock at a deactivated location stays in totals | Keep | Known limit; move stock before deactivating |
| F12 | `supplier_item` keeps column UPDATE grant for `authenticated` | Before go-live | Mapping memory editable outside the review procedures; small revoke; roles-in-Postgres invariant |
| F13 | PIN-change window (old-PIN session survives; 502 leaves an audit row) | Phase 2 | Narrow and audited; fold into C1 (auth) |
| F14 | M1 import validation inside RPCs; CSV quote; 413 for chunked | Phase 2 | Admin-only path; wrong status codes, no data risk |
| F15 | M2 upload: DB-side hourly limit, encrypted-PDF check, constants comment | Phase 2 | Matters once C11 adds a second intake; fold in there |
| F16 | Money-guard gaps (`euro`/`eur`/`valueEur`, over-matching) | Phase 2 | Defence for "waiters never see costs"; no known leak; fold into C1 early |
| F17 | Loosen money guards for owner-only payloads | Keep | Strict is safe; only a convenience |
| F18 | G4 service-worker items | Phase 2 | Parked (offline low priority, §2.4) |
| F19 | G6 listing of orphan Storage objects | Phase 2 | Fold into C11; more files and backups make orphans matter |
| F20 | Date-bomb guard blind spots | Phase 2 | Test-guard hardening, no runtime effect |
| F21 | TOTP for owner (optional) and admin (required) | Phase 2 | Founder 2026-11-08: early Phase 2 item, after go-live (C1) |
| F22 | G11 index `applied_op(tenant_id, received_at)` | Phase 2 | No effect at one venue (M25 §3.6); next migration-adding plan |
| F23 | Approval walks the cost graph twice per over-threshold ingredient | Keep | PRD assumes ~25 invoices a month; no complaint yet |
| F24 | Chef cost endpoint passes keys in the URL | Keep | Only long at a few hundred plates |
| F25 | Payables rules lock every open payable due in 7 days | Keep | Small volume at one venue |
| F26 | Extraction timeout: measure `outputTokens`/`durationMs` on staging | Before go-live | Real invoices start at go-live; measure now, fix only if data shows a need |
| F27 | Recipe import into an empty tenant can be slow | Keep | One-off at setup; ANALYZE by hand if needed |
| F28 | G10 focus to `<body>`; `aria-expanded` never true | Phase 2 | Accessibility polish batch |
| F29 | Approval prompt still says "debito" | Phase 2 | Wording polish batch; not a data issue |
| F30 | Invoice list capped at 100 rows, no paging | Phase 2 | Reached only after months of invoices |
| F31 | M4 review gaps (duplicate clear, old `supplier_item`, inactive reactivation, split unit) | Phase 2 | Review polish; fold into C11 (same pipeline) |
| F32 | M5 duplicate-flow notes | Phase 2 | Same review polish; fold into C11 |
| F33 | Recipe export includes active recipes only | Keep | Export→re-import into an empty tenant is not a venue workflow |
| F34 | Name-length mismatch (characters vs UTF-16) | Keep | Emoji names only; falls back to generic text |
| F35 | Cost walk keeps one depth per recipe across roots | Keep | Only hand-built 13-deep chains |
| F36 | Forecast panel `aria-labelledby` dangling on error | Phase 2 | Fold into C6 |
| F37 | Ieri tile shows a 0-cover service line | Phase 2 | Ask the owner at UAT whether it is wanted |
| F38 | Waiter "Pronto" on dishes | Phase 2 | Candidate C15, after the supervised run |
| F39 | Per-supplier hints in the extraction prompt | Keep | Deferred until the quality report shows a need |
| F40 | M10 Google Drive folder watch | Drop | D8 default accepted 2026-11-11 (founder may revisit): e-mail-in (C11) instead; one extra intake is enough |
| F41 | G15 `dashboard-4g.spec.ts` needs `PERF_4G_STORAGE_STATE` | Phase 2 | CI hygiene: M25 §3.6 lists it as an unused perf spec, "After go-live"; the go-live timing runs (M25 step 21) use the 4G workflow `perf-dashboard-4g.yml`, not this spec |
| F42 | G16 parity fixture shares a value | Phase 2 | Test hardening |
| F43 | G18 stale migration header | Keep | Next migration-adding plan carries the corrected wording (already the rule) |
| F44 | `page-requests.json` counts not logged on green runs | Phase 2 | CI hygiene |
| F45 | Fill `docs/go-live/csp-impact.md` | Before go-live | G7-4 is blocking |
| F46 | `push-forecast.spec.ts:152` page closed mid-test | Phase 2 | Unexplained flake; investigate in a CI batch |
| F47 | Native-run flakes (pgTAP 241, 082, 174) | Phase 2 | CI hygiene |
| F48 | e2e forecast heading race at 02:00; pgTAP 256 planner dependence | Phase 2 | CI hygiene |
| F49 | Custom-range check duplicated in `report/page.tsx` | Phase 2 | Logic in a React file; small refactor toward [API] |
| F50 | CI cache split, `actions/cache@v5`, perf workflow cache | Phase 2 | CI hygiene |
| F51 | Required status checks vs `paths-ignore` | Phase 2 | Docs-only PRs could hang; repo hygiene |
| F52 | `RESEND_API_KEY` in `.env.example`, read by nothing | Keep | Reservations PR2 and S8-3 bring Resend into use (customer booking e-mails and Auth SMTP; not alerts) |

#### 2.5.2 Open plan questions with defaults (close-out §2)

**Legal / GDPR** (data-protection points are for the venue's data-protection adviser (to identify), with DPA-1)

| Question | Group | Reason |
|---|---|---|
| Q11 code and IP ownership | Before go-live | The DPA (Q13) depends on who is controller, processor and owner |
| Q13 GDPR roles, DPA, sub-processors | Before go-live | DPA-1 is a blocking checklist row |
| Q14 retention (staff, PIN log, alerts, ledgers) | Before go-live | DPA-1 must state retention |
| Q21 allergen matrix phase | Phase 2 | Candidate C16; legal duty for the venue's consultant to confirm |
| M11 Q2 retention of PIN log, sessions, codes, IP hash | Keep | Defaults set; record them in the DPA |
| M11 Q10 per-person login times | Keep | Owner sees none: lowest exposure (data-protection adviser to confirm) |
| M6 Q3 alerts kept for good | Keep | Until Q14 sets a retention |
| M13 Q38 `job_run` kept for good | Keep | Internal run records, no personal data |
| M20 Q120 `applied_op` retention | Keep | Parked with offline; decide with Q14 |
| M20 Q124 data kept on the phone; GDPR register line | Before go-live | Belongs in the staff GDPR register entry (M11 M-6, blocking) |
| Q96 demo purge record retention | Keep | Follows the audit trail; staging only |
| M7 Q2 recipe file format; imported allergens not confirmed | Keep | Safe default |

**Hosting / billing**

| Question | Group | Reason |
|---|---|---|
| Q9 who owns and pays each account | Keep | Default: DigiAlto accounts (PR #1); Vercel Pro for production decided 2026-11-08. The account owners themselves (Q26) are still to fill in |
| Q10 which plans | Keep | Decided 2026-11-08; Supabase Free production (Q187) |
| Q12 app domain and sending domain | Before go-live | FREE-3 and S8-3 are blocking |
| Q26 where logins live, MFA owner, recovery codes | Before go-live | Runbook owners are blocking; C1 recovery builds on it |
| M3 Q5 which environments get an extraction key | Before go-live | Production needs one |
| Q95 GitHub Actions minutes | Drop | CI has run heavily since; obsolete |
| Q15 repo name | Drop | Repo in use; answered in practice |
| M0 Q-F one tenant per login | Keep | Revisit with Phase 3 multi-venue |

**Fiscal / RCH** (all confirmations are for the venue's accountant)

| Question | Group | Reason |
|---|---|---|
| Q20 / M3 Q2 / M4 Q1 / M5 Q2 gross vs net check; VAT rates | Before go-live | Decides which real invoices can be approved |
| M3 Q3 / M4 Q2 / M5 Q3 negative lines, credit notes | Before go-live | Real invoices with discounts or deposits would fail extraction |
| M5 Q5 short-delivery credit with VAT | Before go-live | Same accountant session; affects payables |
| M5 Q6 due date when none is given | Keep | Refusal until typed is safe |
| M8 Q3 sale VAT rate | Before go-live | Every margin depends on it |
| M17 Q73 coperto VAT rate | Before go-live | Same accountant session |
| Q23 / M21 Q126 payment types | Before go-live | "Altro" is a placeholder |
| Q8 / M21 Q133 who enters the register total | Before go-live | Needed for gate G3-2 |
| M21 Q130 fatture in the register comparison | Keep | Shown apart; sensible default |
| M21 Q131 sign and base of the difference | Keep | Sensible default |
| M21 Q132 receipt number fixable after close | Keep | Final close is by design (ADR-023) |
| M21 Q134 split of shared dishes and coperto | Keep | Sensible default; C17 extends it to weight lines |
| M9 Q30 separate supplier credit notes | Phase 2 | A feature, if the accountant says they are common |

**Hardware / devices**

| Question | Group | Reason |
|---|---|---|
| M11 Q4 trivial PINs | Keep | Built and safe |
| M11 Q5 who manages staff, PINs, devices | Keep | Owner and admin, audited |
| M11 Q6 unlock after 20 failures | Keep | Safe default |
| M11 Q7 tries after a lock | Keep | Safe default |
| M11 Q8 e-mail staff sessions at cut-off | Keep | Only PIN sessions end; as built |
| M11 Q11 device label in lockout alert | Keep | No names asked |
| M11 Q12 enrol inside the installed iPhone app | Keep | Runbook states it |
| M2 Q2 files over 4 MiB | Keep | Decide after real samples; revisit with C11 |
| M18 Q80 phone clock tolerance | Keep | Safe default |
| M20 Q117 owner/admin offline on the comanda | Keep | Offline parked |
| M20 Q119 ops left by a waiter who left | Keep | Offline parked |
| M20 Q121 app icon | Phase 2 | Needs the approved logo |
| M20 Q125 logout with queued ops | Keep | Offline parked |

**Ops**

| Question | Group | Reason |
|---|---|---|
| Q1 10 sample invoices | Phase 2 | Needed before any extraction-model change (contract test), not to go live |
| Q2 recipe list, batch sizes, shelf lives | Before go-live | Production needs real recipes |
| Q3 supplier lead times, delivery days | Keep | Filled during setup; rules show "Da completare" |
| Q4 / M8 Q5 fixed monthly costs | Keep | "Not allocated" until figures exist |
| Q5 / M21 Q127 tables, covers, coperto | Before go-live | S8-14 and real service need them |
| Q24 milestones that may move | Drop | All MVP milestones are built |
| Q25 app brand | Keep | Colours and fonts approved; logo pending |
| M7 Q7 loading real recipes | Before go-live | Production tenant needs them |
| M4 Q4 starting cost centres | Keep | None preset is fine |
| M4 Q5 what counts as a correction | Keep | Sensible default |
| M8 Q8 chef's spreadsheet format | Keep | Default format |
| M13 Q33 DigiAlto receives drift alerts | Keep | In-app only (ADR-006, reconfirmed D3 2026-11-11) |
| M13 Q34 e-mail for drift | Keep | No: alerts stay in the app (ADR-006, reconfirmed D3 2026-11-11) |
| M18 Q81 AT7 timing run | Drop | Superseded by G7 runs |
| Q116 where dashboard speed is measured | Drop | Superseded by the 4G workflow on staging |
| Q90 demo shown on staging only | Keep | As built |
| Q92 short wait before demo removal | Keep | Acceptable |
| Q93 osteria tries demo with own login | Keep | No |
| Q94 demo name | Keep | As built |

**Product**

| Question | Group | Reason |
|---|---|---|
| Q7 half portions and shared plates | Keep | Answered yes; built |
| Q17 / M8 Q6 fixed cost before 30 days | Keep | "Not allocated" is honest |
| Q19 portion rounding | Keep | Chef can edit |
| Q22 staff session length | Keep | Built in M11 |
| Q29 "scheduled" payables reminder | Keep | Sensible default |
| M1 Q2 / Q3 / Q4 foreign suppliers, VAT checksum, chef sees terms | Keep | As built |
| M1 Q5 CSV template | Keep | Our template |
| M4 Q6 remember non-stock lines | Keep | Revisit if review time exceeds the PRD target |
| M5 Q4 same at approval | Keep | No effect |
| M5 Q7 location per invoice | Keep | Simple default |
| M5 Q8 undo an approval | Keep | Corrections and "disputed" keep ledgers append-only |
| M6 Q1 default alert audiences | Keep | Revisit with C9 (audiences become settings, in-app) |
| M6 Q2 chef sees quantity-only alerts | Keep | Founder to confirm A1 in passing |
| M6 Q4 day for "one alert per day" | Keep | As built |
| M7 Q3 sale price VAT included | Keep | As built |
| M7 Q4 batch inside a batch | Keep | Not needed so far |
| M7 Q5 max yield factor | Keep | Safe bounds |
| M8 Q1 simple moving average | Keep | PRD default |
| M8 Q2 which max price | Keep | As built |
| M8 Q4 GP% on food cost | Keep | As built |
| M8 Q7 never-invoiced ingredients | Keep | "Costo incompleto" is honest |
| M8 Q9 price alerts on decreases | Keep | As built |
| M8 Q10 / Q11 who changes N, threshold, VAT, basis | Keep | Owner and admin, audited |
| M9 Q31 disputed in supplier balance | Keep | Shown apart |
| M9 Q32 weekly summary contents | Keep | As built |
| M12 Q2 which movements the chef may undo | Keep | Reversals keep the ledger append-only |
| M12 Q3 negative-stock alert audience | Keep | As built |
| M12 Q4 waste valuation | Keep | As built |
| M12 Q5 moving more than recorded | Keep | Refusal is safe |
| M12 Q6 kitchen-usage form | Keep | Not needed so far |
| M12 Q7 expired lots | Keep | Strict FEFO |
| M12 Q8 lots without expiry | Keep | Used last |
| M13 Q35 close a count with items missing | Keep | As built |
| M13 Q36 who picks critical ingredients | Keep | As built |
| M13 Q37 count differences in "Sprechi" | Keep | Kept apart |
| M13 Q39 chef sees the activity log | Keep | No |
| M14 Q40 use-by across a clock change | Keep | Elapsed hours |
| M14 Q41 recipe part of the lot code | Keep | Revisit only if C2 label layout needs it |
| M14 Q42 extra ingredients at production | Keep | No |
| M14 Q43 portions above computed | Keep | As built |
| M14 Q44 production time | Keep | Moment of confirm |
| M14 Q45 one ingredient from two places | Keep | No |
| M14 Q46 lot choice | Keep | FEFO with override |
| M14 Q47 producing with less stock | Keep | Recorded and alerted (plan §3.6 rule 8) |
| M15 Q48 split an expired batch | Keep | Refused |
| M15 Q49 staff meals per day | Keep | As built |
| M15 Q50 staff meal with too few portions | Keep | Refused |
| M15 Q51 undo a discard | Keep | Fix with "Conta" (append-only) |
| M15 Q52 who sets staff-meal rules | Keep | As built |
| M15 Q53 batch actions in Registro | Keep | Revisit with C2 scan-to-act |
| M16 Q60 purchase alert audience | Keep | Owner only; revisit with C9 (in-app) |
| M16 Q61 who sets batch min/target | Keep | As built |
| M16 Q62 waste in forecast | Keep | No; revisit with C6 |
| M16 Q63 new ingredient history | Keep | As built |
| M16 Q64 expired stock alert daily | Keep | As built |
| M16 Q65 "Ordinato" button | Phase 2 | Fold into C6 order guide |
| M16 Q66 minimum without supplier days | Keep | "Da completare" |
| M16 Q67 same-day reversals in average | Keep | Accepted for MVP; C6 replaces it |
| M17 Q68 closed table display | Keep | As built |
| M17 Q69 same dish at two prices | Keep | No |
| M17 Q70 chef marks "esaurito" | Keep | 86'd by stock |
| M17 Q71 dishes sold by weight | Before go-live | D10 (2026-11-11): weight sales go in Phase 2 (C17, P2-6). Before go-live only OQ-2 remains: how per-etto dishes are rung up until then (default: a fixed placeholder portion agreed with the chef) |
| M17 Q72 table with no covers | Keep | 1–99 |
| M17 Q74 price for margins | Keep | Menu price |
| M18 Q75 meaning of "segue" | Keep | As built |
| M18 Q76 unsent dishes against portions | Keep | No |
| M18 Q77 when "Ne restano N" shows | Keep | At 3 or fewer; C17 defines it for weight lines |
| M18 Q78 order 2 with 1 left | Keep | Allowed |
| M18 Q79 price if a push ends | Keep | Price at order |
| M19 Q97 segue at the pass | Keep | As built |
| M19 Q99 chef sends courses | Keep | No |
| M19 Q100 raw from two areas | Keep | FEFO anywhere |
| M19 Q102 confirm on "Invia" | Keep | No |
| M19 Q103 void reasons | Keep | As built |
| M19 Q104 who sees the cost of a sent dish | Keep | Owner and admin |
| Q111 food cost % before sales | Keep | As built |
| Q112 plates without GP target | Keep | As built |
| Q113 seen items stay on today's list | Keep | As built |
| Q114 count dashboard opens | Drop | M22 built it |
| Q115 "due soon" window | Keep | 7 days |
| UX Q3 renames | Keep | As built |
| UX Q7 an "Impostazioni" page | Keep | None; revisit if C9 adds many settings |
| M20 Q118 sold-out while offline | Keep | Offline parked |
| M20 Q122 two waiters open a table offline | Keep | Offline parked |
| M20 Q123 covers and "Conto richiesto" offline | Keep | Offline parked |
| M21 Q135 close a table offline | Keep | Closing is online-only by design (ADR-023) |

---

### 2.6 UAT findings

> **EMPTY — no UAT findings have been written down yet.**
> When the supervised run or user tests produce findings, list them here (date, who, screen, what happened, severity) and triage
> each into the same four groups as §2.5. Findings may change the milestone order in Part 3.

| Date | Reported by | Screen / flow | Finding | Group | Reason |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

---

#### C18. Sold out on the public menu — founder 2026-11-11: Phase 2, later (after P2-5)

- **Status:** founder-placed "Phase 2, later", after P2-5 (added 2026-11-11, relayed by the lead).
- **Value:** customers see "Esaurito" on the public menu site when the app has no portions of a dish left, without anyone
  editing the site by hand. Only the state is shown, never a count.
- **What the site is today** (read by the lead 2026-11-11): https://menu.osteriadeirossi.it/ is a hand-built single page that
  loads `data/menu.json` with `fetch("data/menu.json", { cache: "no-store" })`. The file has `version`, `updated_at`, `updated_by`
  and `sections[].groups[].items[]`; each item has a stable `id` (e.g. `tagliere-del-cacciatore-rt`) and a manual
  `"esaurito": false` flag, and the page already renders sold out (`soldout` class). DigiAlto maintains it; where its source
  lives is a founder question.
- **Design sketch:**
  - menu items get an optional `public_menu_id`, set by owner/admin (tenant-scoped, unique per tenant);
  - a public, read-only `GET /api/public/menu-availability/<slug>` returns `{ soldOut: [public ids], updatedAt }` for linked
    items whose portions are 0: no counts, prices, costs or names; the tenant comes from the slug (the reservations slug or its
    own); CORS for the menu origin only; a short cache (about 60 s) and a rate limit; no auth, no writes;
  - the site's JS fetches it after `menu.json` and ORs it with the manual `esaurito` flag; a failure is silent, so the site
    works without the app;
  - only portion-tracked items switch automatically; the manual flag stays for everything else.
- **Size:** S to M (one public read route, one column with its owner/admin setting, a few lines in the site's JS).
- **Dependencies:** the production custom domain (staging sits behind Vercel SSO, so the site cannot call it); the site's
  source and who deploys it; ADR-028's CSP and the reservations public-route pattern (gate, rate limit, identical `not_found`).
- **Risks:**
  - cache staleness: a dish can show available for up to the cache window after it sells out (and the reverse); acceptable for
    a menu, say so on the site if needed;
  - tenant enumeration: unknown, disabled and not-ready slugs must give the same `not_found` as the reservations routes;
  - exposure: the route must never carry counts, prices, costs or names (guard test, as for the public booking routes);
  - DPA impact: none (no personal data).
- **Invariants touched:** balances stay derived from the ledgers (the route reads the same derived portions as the app);
  waiters-never-see-costs is unaffected (no cost leaves); RLS: a SECURITY DEFINER read for `anon`, as the reservation wrappers.
- **Founder questions:** where does the site's source live, and who deploys it? Which slug: the reservations one or its own?
  Cache window (default 60 s)?

## Part 3 — Milestone order (D1 accepted 2026-11-11, plus P2-6)

P2-0…P2-5 are the steps the founder accepted on 2026-11-11 (D1), unchanged. P2-6 is added after them for "Sell by weight" (D10).
**Update (founder, later on 2026-11-11):** sell by weight moves to **P2-0b**, right after the P2-0 PRs and before P2-1 (TOTP), so
it is live for go-live on 12 January; its plan is `docs/plans/2026-11-11-p2-0b-sell-by-weight.md`. The P2-6 row below is kept
for the record of the earlier proposal.
Labels P2-0…P2-6 are this proposal's names; project-plan numbers are given where they exist. No dates are promised.

| Step | What it delivers | Candidates | Size | Why it sits here |
|---|---|---|---|---|
| **P2-0 Go-live carry-overs** (before go-live, not Phase 2 proper) | F1–F2 (A5b, already in progress), F12 (`supplier_item` grant), F26 (extraction timing on staging), F45 (`csp-impact.md`); plus the "Before go-live" answers of §2.5.2 from the founder, the accountant and the chef, including **OQ-2** (the placeholder portion for per-etto dishes, agreed with the chef and set up as ordinary menu items) | — | M (code part S; A5b is its own L branch) | Go-live-critical: a role leak, the CSP verdict (G7-4), real-invoice readiness and real-data answers. Must land before anything else |
| **P2-1 Second factor** | TOTP admin required, owner optional, `aal` checked in Postgres; recovery path; folds F13 and F16 | C1 (new number) | M | The founder decided TOTP comes "early in Phase 2, after go-live" (2026-11-08); placing it first is this proposal's recommendation, because it protects the accounts that see every cost and needs no hardware or new provider. M-6 settled: TOTP is free on all Supabase projects (C1) |
| **P2-2 Trace and sell-through** | Forward/backward lot trace, lot capture encouraged at receiving; push sell-through; reservations V2 (chef sees booked covers, counts only; D9 default) | C3 (M31 part 1), C12 (M38), C14-V2 | M | Pure reporting over data that already exists: no hardware, no provider, low risk; gives the owner early Phase 2 value while hardware decisions are pending |
| **P2-3 Labels and scan-to-act** | Device test spike first; label rendering (62 mm), AirPrint/Android print, decant labels; QR scan opens the batch or lot with consume/discard/count/reprint; then HACCP register views | C2 (M28, M30), C4 (M31 part 2) | L | Needs a printer purchase, which the PRD places after the two-week supervised run (Gate 4 decision), and a real-device test; builds on P2-2's trace; the bridge (M29) only as a variant if AirPrint fails (D4 default) |
| **P2-4 Full alert rules engine, in-app only** | Thresholds and audiences of the alert rules as audited tenant settings; per-rule isolation revisited; alerts stay in `/avvisi`; folds F7 | C9 (M27) | M | No hardware, no provider, no new secret (D3: no Telegram, no e-mail alerts). It makes the existing alerts adjustable before any new alert kinds (e.g. a later sensor pilot, C5) are added |
| **P2-5 Accountant** | Invoice CSV with VAT per rate; read-only accountant role only if the accountant wants a login (D6 default) | C10 (M36) | M | Depends on the accountant confirming formats (Q20, Q170), which the go-live accountant session starts; no hardware |
| **P2-6 Sell by weight** | Per-etto menu items; grams on the order line; price per etto computed in SQL; proportional depletion and frozen cost at fire; voids, bill, day close, KPIs, exports and offline ops extended | C17 (new number) | L | Placed after the accepted order so D1 stays as the founder approved it. It is L and changes pinned order procedures (`fire_course`, `void_line`, bill), so it should not ride inside a reporting or hardware step; it needs the chef's and accountant's answers (dishes, portion weights, rounding), which the supervised run gives time to collect; the OQ-2 placeholder covers the gap. It comes **before** the forecast (C6) and menu engineering (C7), which read plate counts and mix and should learn from real weight sales. If the placeholder proves painful during the supervised run, the founder can pull P2-6 forward to straight after P2-1 |

**After P2-6 (in suggested order, each re-planned when chosen):**
1. C6 demand forecast + prep list + order guide (M32, M33) — needs weeks of real sales and a weather-location decision.
2. C7 menu engineering + own-supplier price comparison (M34) — also better with weeks of sales.
3. C5 temperature-sensor pilot — D5: after P2-4, once the HACCP consultant confirms, and only after OQ-1 is re-decided with the founder.
4. C11 e-mail-in (M37) — D8 default; the Drive watch (M10) is dropped.
5. C8 AdE corrispettivi cross-check (M35) — parked (D7 default) until the accountant identifies the file.
6. C15 waiter "Pronto", C16 allergen matrix, C13 KDS/ESC-POS — on request after the supervised run.
6b. C18 sold out on the public menu — founder-placed "Phase 2, later", after P2-5 (2026-11-11); needs the production custom
   domain and the site's source.
7. The Phase 2 "polish and CI" batch from §2.5.1 (F3, F6, F14, F20, F22, F28–F30, F37, F41, F42, F44, F46–F51; plus F10, F31–F32 and
   F36 if their host candidate C7, C11 or C6 is not chosen) — can be interleaved as S fixes between milestones. F3 (G13) is flagged
   to the founder in M25 §3.6 and is the first of the batch.

**Not in scope (founder 2026-11-11):** Telegram alerts (project M26, project plan V1) and e-mail alerts (D3).

**Alternatives considered for the order:**
- *Labels first after TOTP (PRD: "One label printer is the first purchase worth making").* Rejected as the default because it waits on
  a purchase (which the PRD puts after the supervised run) and a device test, while P2-2 can start the day after TOTP with no outside
  dependency. If the printer is bought early, P2-2 and P2-3 can swap.
- *Forecast early (highest-profile PRD item).* Rejected: with few weeks of real sales the MAPE shown would undermine trust in it.
- *Raspberry Pi bridge as the main print path (PRD design).* Rejected as default: on-site hardware and a tunnel account versus a
  phone print dialog that research found workable; kept as a variant if the device test fails.
- *Sell by weight straight after TOTP (before P2-2).* Not proposed as default because it would change the order the founder accepted
  (D1) and its answers (dishes, weights, rounding) are not yet available; kept as the founder's option if the placeholder hurts.
- *Sell by weight folded into P2-2.* Rejected: P2-2 is read-only reporting (M); C17 is L and rewrites core write procedures.

---

## Part 4 — Decisions and open questions

### 4.1 Decisions D1–D10 (as asked, with the founder's answers of 2026-11-11)

| # | Decision | Recommended default (as proposed) | Founder answer 2026-11-11 |
|---|---|---|---|
| D1 | Phase 2 order (P2-0…P2-5 are this proposal's names for the six steps in Part 3: P2-0 go-live fixes, P2-1 authenticator codes, P2-2 trace and sell-through, P2-3 labels, P2-4 alert rules (in-app), P2-5 accountant) | P2-0 → P2-5 as in Part 3 | **Accepted** as proposed. P2-6 (sell by weight) added after it |
| D2 | TOTP (a six-digit code from an authenticator app on the phone, asked at sign-in on top of the password): recovery when a phone is lost; owner enrolment | Recovery by a second, backup TOTP factor enrolled at the same time (Supabase has no built-in recovery codes; its docs recommend a backup factor), plus a reset by the other admin or owner account, recorded in the audit log; owner offered TOTP at next sign-in, not forced | Default accepted — **default, founder may revisit** |
| D3 | May alerts leave the app (reverses part of the 2026-10-23 decision)? | Proposed: Telegram to the owner only, without € amounts, e-mail as fallback | **No.** The 2026-10-23 decision stands: alerts stay in the app; Telegram and e-mail alerts **not in scope (founder 2026-11-11)**. P2-4 is the rules engine, in-app only |
| D4 | Label printer, print path and timing | After the two-week supervised run (the PRD: "nothing is bought until the loop has run for two weeks under supervision"; Gate 4 holds the printer decision), buy one Brother QL-820NWBc once a device test passes; print from the phone (AirPrint/Android); no Raspberry Pi bridge unless the test fails | Default accepted — **default, founder may revisit** |
| D5 | Temperature sensors in Phase 2? | Not in the first six steps; if wanted, a Shelly pilot after P2-4, once the venue's HACCP consultant says how automatic records fit their manual | **Later, after P2-4, as a pilot once the HACCP consultant confirms.** The in-app-only alarm consequence is open question OQ-1 |
| D6 | What the accountant needs | A monthly invoice CSV with VAT per rate first; a read-only login only if the accountant asks | Default accepted — **default, founder may revisit** |
| D7 | AdE corrispettivi cross-check | Park until the accountant identifies the file and who downloads it; never store the venue's tax-portal credentials | Default accepted — **default, founder may revisit** |
| D8 | Extra invoice intake | E-mail-in later (after the domain and Resend exist); drop the Drive folder watch | Default accepted — **default, founder may revisit** |
| D9 | Reservations: may the chef see booked covers (V2)? Others? | Yes to V2 (counts only, no names); keep V1 "no", and the V3, V5, V6 defaults | Default accepted — **default, founder may revisit** |
| D10 | Dishes sold per etto on the draft menu (M17 Q71) | Decide with the chef before real service: a fixed portion size, or weight sales as a Phase 2 item | **Weight sales go in Phase 2** (C17, P2-6). Until then: OQ-2 |

### 4.2 Open questions for the founder

| # | Question | Default in force | When it must be answered | Why it matters |
|---|---|---|---|---|
| **OQ-1** | Alerts stay inside the app (D3), so a night-time freezer (or fridge) alarm from a sensor pilot would only be seen when someone next opens the app. Is that acceptable for a sensor pilot, or does the founder want to re-decide how such an alarm reaches someone? | None — **must be re-decided with the founder before any sensor pilot (C5)**. Not a decision yet | Before C5 is planned | An alarm nobody sees until morning gives a record but no chance to save the stock; the HACCP consultant may also have a view on response times |
| **OQ-2** | How are per-etto dishes rung up in the app from go-live until "Sell by weight" (C17) ships? | A fixed placeholder portion per dish, agreed with the chef, set up as an ordinary menu item and price (no code) | **Before go-live** (P2-0) | Waiters need a way to enter these dishes on day one; the placeholder's price and portion size drive revenue, depletion and food cost for those dishes until P2-6 |
| OQ-3 | C17 details: which dishes, their reference portion weights, who types the grams, the price rounding rule (with the accountant), how a weight line counts in "plates sold" and mix, an upper bound per line | None; collected during the supervised run | Before P2-6 is planned | They shape the data model and every report that counts plates |

Also needed (not decisions, answers): the "Before go-live" questions of §2.5.2 (accountant: Q20, M3 Q3, M5 Q5, M8 Q3, M17 Q73; founder:
Q11, Q12, Q13, Q14, Q26, M3 Q5, Q8, Q23, M20 Q124; chef/owner: Q2, Q5, M7 Q7, and OQ-2). (Founder step M-6, whether TOTP is available
on Free, is settled: it is; see C1.)

---

## Part 5 — Risks of the proposal itself

- **Client facts:** legal name, VAT number, privacy contact, booking hours, venue address and phone, menu, prices, per-etto dishes and
  allergens are not approved. C6 (weather location), C10 (accountant identity), C16 (allergens) and C17 (per-etto dishes, prices and
  portion weights) cannot be finished without them.
- **Alerts stay in the app (D3):** every alert, including any future sensor alarm, is seen only when someone opens `/avvisi`. This is
  the founder's accepted trade-off (ADR-006); its consequence for sensors is OQ-1.
- **Placeholder period for per-etto dishes (OQ-2):** until P2-6, those dishes are recorded as fixed portions; revenue, depletion and
  food cost for them follow the placeholder, and the append-only ledgers keep those rows as they were.
- **Third parties:** Resend inbound (C11), UbiBot cloud (C5, if chosen for the pilot), a CAPTCHA provider (C14-V3) and a tunnel
  provider (bridge variant) are each a new sub-processor: the DPA and sub-processor list (Q13, DPA-1) must be updated, and their
  prices, fees and data retention are **open questions, not estimated here**. No alert-channel provider is planned (D3).
- **Legal and fiscal:** HACCP registers (C4), temperature records (C5), allergens (C16), the accountant file (C10), corrispettivi (C8)
  and per-etto pricing and receipts (C17) need confirmation by the venue's consultant or accountant; personal-data points (C2, C10, C11,
  C14) by the venue's data-protection adviser (to identify) with DPA-1. This proposal states no law.
- **Hardware:** AirPrint scaling bugs and iOS PWA printing are unverified; label adhesive in the freezer failed in one independent
  test; Shelly does not buffer readings. Every hardware milestone starts with a device test.
- **Security:** every new path keeps tenant resolution server-side (QR, sensor token, receiving address, booking host), never from the
  payload; no new use of the secret key outside the allowed paths without an ADR; waiters never receive cost fields (C17 extends the
  waiter-cost column test to weight lines).

## Sources

- Repo documents listed under "Inputs read" at the top.
- Hardware research, DigiAlto-Ops deliverable dated 2026-11-05 (prices "seen in search on 2026-11-05, capture date unknown"; its
  unverified marks carried over above).
