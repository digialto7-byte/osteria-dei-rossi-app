# Prenotazioni online: runbook

For the person who runs the app for the venue (DigiAlto). It covers switching the public booking page on, rotating its keys, and erasing a customer's data on request. The design
is in `docs/plans/2026-11-08-reservations.md` and `docs/adr/adr-032-public-reservation-requests.md`. Screen names are quoted as the app shows them.

Nothing here contains a real value. Names, the VAT number, the privacy contact and the booking hours are the client's and are **[PENDING founder]** until the founder approves them
(`docs/client-facts.md`).

## Switch the page on

Nothing goes public until the owner switches it on. The switch needs a page address, the legal name and a privacy contact for the notice, and the booking hours of at least one service.
We do not guess the hours (Q-R5).

1. Check the deployment has its settings (Vercel, Production and Preview): `RESERVATION_GATE_KEY` and `RESERVATION_LINK_KEY` (each at least 32 characters), `MAIL_TRANSPORT=resend`,
   `MAIL_FROM`, `RESEND_API_KEY`, `APP_PUBLIC_ORIGIN` (https). Check the project's Vault has `reservation_gate_key` (equal to `RESERVATION_GATE_KEY`) and `reservation_hash_salt`
   (`docs/guides/cron-vault-secrets.md`). `mailpit` is refused in production.
2. As the owner or the admin, open "Tavoli, impostazioni", card "Prenotazioni online".
3. Fill in "Indirizzo della pagina" (3 to 40 lowercase letters, digits and hyphens; unique across the whole app), the controller name and the privacy e-mail from the client's
   approved facts, the booking hours of each service, and the limits you agreed. Under "Tavoli prenotabili" mark the bookable tables with their seats (customers never see tables).
4. The checklist under "Per attivarle manca ancora" lists what is missing. When it is empty, turn on "Accetta prenotazioni online". Saving it earlier is a 422 with the reasons.
5. Open `<APP_PUBLIC_ORIGIN>/prenota/<slug>` signed out, on a phone: pick a date, a party and a time, send a request, and check that the "received" e-mail arrives with a cancel link.
   Then accept it in "Prenotazioni" and check the "accepted" e-mail. An unknown, switched-off or not-ready address gives the same "not available" page.
6. The privacy notice text is a DigiAlto draft (`RESERVATION_NOTICE_VERSION`). The client approves it before real customers use the page (Q-R12); bump the version string with every
   change of the text.

If the page answers "Le prenotazioni online non sono disponibili al momento" (503), a key is missing or the two gate keys differ: compare Vercel's `RESERVATION_GATE_KEY` with Vault's
`reservation_gate_key`. The error reporter gets only the code `reservation_gate_invalid`.

## Rotate the keys

**Gate key** (`RESERVATION_GATE_KEY` and Vault `reservation_gate_key`), without a gap:

1. Make a new value (`openssl rand -hex 32`) and add it to Vault as `reservation_gate_key_next`. The database now accepts either key.
2. Set `RESERVATION_GATE_KEY` in Vercel to the new value and redeploy.
3. Move the new value into `reservation_gate_key` (`vault.update_secret`) and delete `reservation_gate_key_next`.

**Link key** (`RESERVATION_LINK_KEY`, signs cancel links and form tokens):

1. Set `RESERVATION_LINK_KEY_PREVIOUS` to the old value and `RESERVATION_LINK_KEY` to the new one, then redeploy. Links carry the first 8 hex characters of their key's SHA-256, so both
   keys verify.
2. Delete `RESERVATION_LINK_KEY_PREVIOUS` once the booking horizon has passed (every older link has expired).
3. In an emergency drop it at once: older links then show "il link non è valido o è scaduto".

**Hash salt** (`reservation_hash_salt`, Vault only): change it at any time; only the day's abuse counters reset.

**Resend key** (`RESEND_API_KEY`): create a new key in Resend, set it in Vercel, redeploy, delete the old key.

## Erase a customer's data on request

Customers can ask the venue to erase their data (GDPR). The contact (name, phone, e-mail) is deleted automatically `retention_days` after the booked date (a tenant setting, "Giorni di
conservazione dei dati clienti"); on request, do it at once:

1. As the owner or the admin, open "Prenotazioni" on the booking's day and open the booking.
2. Tap "Cancella dati cliente" and confirm. The row then shows "Dati cancellati"; the booking itself (date, time, party, status) stays for statistics.
3. E-mails still queued for that booking are skipped. Backups keep the deleted contact until they rotate out (up to 14 daily copies); the privacy notice says so.
4. Answer the person in writing from the privacy contact. The request and its date belong in the venue's own register.

The nightly job `reservation-retention` does the automatic deletion and is watched: if it has not succeeded for 48 hours, the health check raises a finding.

## Before real customers

These are the founder's decisions, not the code's:

- the custom domain for the app (staging and preview are behind Vercel's login), then `app_base_url` and `APP_PUBLIC_ORIGIN` follow it (Q-R15);
- a Resend account with a verified sending domain, and what Resend keeps and where (Q-R14);
- the legal name, VAT number, privacy contact and the booking hours of each service: **[PENDING founder]**;
- the approval of the privacy notice text (Q-R12) and a data processing agreement with the venue (Q13).
