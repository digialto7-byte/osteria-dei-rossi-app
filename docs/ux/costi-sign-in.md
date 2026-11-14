# Screens: Costì sign-in and device enrolment

- **Status:** draft · **Author:** UX/UI designer · **Date:** 2026-11-14
- **What this is:** the reference spec of the **product surfaces** as built on `main` (PRs #87, #88), so the go-to-market work can reuse
  them, plus a short list of proposals (§7). Nothing here changes what the builder ships unless the lead accepts a proposal.
- **Look:** Costì (`docs/ux/costi-design-system.md`). The band keeps the **venue's** name; the product speaks in the page (ProductLogo,
  intro). Strings are quoted from `it.ts` with their key.

## 1. The screens and how people reach them

| Route | Who | Reached from |
|---|---|---|
| `/login`, owner view | Owner, admin, any browser without a device cookie | The app's start (a signed-out visit to any staff page), a session that expired, the installed app |
| `/login`, staff view | Chef, waiter, on an **enrolled** venue phone | The same entry: an enrolled device opens on "Chi sei?" (`/pin` redirects here) |
| `/login/codice` | Owner, admin with two-step verification | After the password or e-mail code |
| `/login/offerta-codice` | Owner, admin without it | After sign-in, once: the offer to turn it on |
| `/login/attiva-codice` | Admin (mandatory) | After sign-in, until enrolled |
| `/dispositivo` | Owner holding a new staff phone | "Abilita questo telefono per il personale" on `/login`; "Abilita questo dispositivo" on a non-enrolled PIN screen |

```
                 ┌── device cookie? ──┐
 any staff URL → /login                │
                 ├─ no ─→ OWNER VIEW: e-mail + password ─→ (codice | offerta | attiva) ─→ Home
                 │            └─ "Inviami il link" ─→ code of 6 digits ─→ …
                 │            └─ "Abilita questo telefono…" ─→ /dispositivo ─→ /login?abilitato=1 ─→ STAFF VIEW
                 └─ yes ─→ STAFF VIEW: "Chi sei?" ─→ name ─→ PIN ─→ /tavoli (waiter) or Home (chef)
                              └─ "Sei il titolare? Accedi con email" (opens the owner form in place)
```

## 2. Page frame (all product surfaces)

```
┌──────────────────────────────┐ 360
│▓ OSTERIA DEI ROSSI ▓▓▓▓▓▓▓▓▓▓│ band: Forest, venue name in Montserrat caps, Off-white
│━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│ 2 px Coral rule (decorative, 3.82 on Forest)
│                              │ paper: Off-white
│ [costì logo]  28 px high     │ ProductLogo (placeholder art until BRAND-1)
│                              │
│ …screen content…             │
└──────────────────────────────┘
```
- Browser bar colour (`theme-color`): Forest, so the status bar continues the band.
- Dark device: paper Charcoal, ink Off-white, primary Sage with Charcoal label; band stays Forest; the reversed logo file.
- Tab title: "Costì".

## 3. `/login`, owner view

```
[costì]
┌ card, white, 4 px Coral top edge ────┐
│ Accedi                         h1 40 │ login.title, Montserrat 600
│ ──  (48 × 2 Coral rule)              │
│ Entra in Costì con la tua email e    │ login.intro
│ la password.                         │
│ Email                                │
│ [                              ]     │ autocomplete=username
│ Password                             │
│ [                     ] [Mostra]     │ quiet toggle, aria-pressed
│ [   Accedi con la password   ]       │ PRIMARY (Forest)
│ Password dimenticata o non ancora    │ login.forgot (muted)
│ impostata?                           │
│ [      Inviami il link       ]       │ secondary
│ Abilita questo telefono per il       │ text link → /dispositivo
│ personale                            │
└──────────────────────────────────────┘
```
- **One primary**: "Accedi con la password". The link path is secondary; device enrolment is a text link.
- **After "Inviami il link":** the e-mail stays, a success note "login.sent" (`role="status"`), then **"Codice di 6 cifre"**
  (`inputmode=numeric`, `autocomplete=one-time-code`, so iOS and Android offer the code from the e-mail), primary "Entra con il codice",
  quiet "Torna alla password".
- **Notices above the form:** an invalid link → `ErrorAlert` "login.linkError"; a session over 30 days → "login.sessionExpired"; a phone
  whose enrolment was revoked → "login.deviceRevoked" (`role="status"`).
- **Errors:** wrong credentials and rate limits are the API's message in one `ErrorAlert` above the primary; the password field is cleared,
  the e-mail kept. "Inviami il link" with no e-mail → "login.needEmail".

## 4. `/login`, staff view (enrolled phone)

```
[costì]
Telefono abilitato: Cucina 1.    success note, only right after /dispositivo
Chi sei?                   h1    pin.title
┌──────────────────────────────┐
│ Marco                [Cuoco] │ one 44 px row per person, role as a neutral badge
│ Giulia           [Cameriere] │
└──────────────────────────────┘
Sei il titolare? Accedi con email     quiet, expands the owner form in place

 → tap "Giulia"
Ciao, Giulia               h2    pin.greeting
PIN
[ ••••                     ]    password type, inputmode=numeric, autofocus, 4 digits
[          Entra           ]    PRIMARY, enabled at 4 digits
[      Cambia persona      ]    secondary
```
- After sign-in the device forgets the previous person, then the waiter lands on `/tavoli` and the chef on Home.
- **States:** wrong PIN → "pin.invalid" with the attempts left; a person locked → "pin.userLocked" with the time, back to "Chi sei?"; the
  device locked → `ErrorAlert` "staffAuthError.device_locked" (the owner form is still one tap away); no person enabled → "pin.empty";
  service down → "pin.unavailable". Every state is words; nothing relies on colour or sound (kitchen noise).
- **No names leak to a non-enrolled browser:** the list comes from `/api/auth/device`, which returns names only for a known device
  token; any other browser gets `{ enrolled: false }`.

## 5. `/dispositivo`

```
[costì]
Abilita dispositivo                h1  enrol.title
Codice di abilitazione                 enrol.field
[ K7P-4QX                    ]         autocapitalize=characters, no autocorrect, max 16
Lo trovi sul telefono del titolare,    enrol.hint
vale 15 minuti.
[         Abilita          ]           PRIMARY
Se usi l'app installata sulla schermata Home, abilitala da lì.   enrol.homeScreenNote (muted)
```
- Success → `/login?abilitato=1`: the staff view with "Telefono abilitato: <nome>".
- Errors: invalid, used or expired code → "Codice non valido o scaduto. Chiedi un nuovo codice al titolare."; too many → "Troppi
  tentativi. Riprova tra 15 minuti."

## 6. Two-step verification pages (owner, admin)

| Page | Content | Primary | Secondary |
|---|---|---|---|
| `/login/offerta-codice` | h1 "mfa.offer.title" "Proteggi il tuo accesso"; "mfa.offer.text" | "Attiva ora" | quiet "Non ora" |
| `/login/attiva-codice` (forced, admin) | h1 "mfa.enrol.title"; "mfa.enrol.forced"; three numbered steps, the QR, the setup key as text for those who cannot scan, the 6-digit field | "Attiva" | no "Annulla": the only other way out is "Esci" |
| `/login/codice` | h1 "mfa.challenge.title"; "mfa.challenge.intro"; the 6-digit field | "Verifica" | quiet "Usa il dispositivo di riserva" / "…principale" |

All three are a plain white card (no Coral top edge: that edge marks only the sign-in card) with one primary each. When the offer's
"Attiva ora" opens the enrolment, it shows "Annulla" (quiet) back to the offer.

## 7. Proposals and the lead's decisions

**Decided by the lead, 2026-11-14** (S1–S3 go into the small-fixes batch of the build queue, after P2-5):
- **S1 accepted:** the PIN is sent on the 4th digit; "Entra" stays.
- **S2 accepted:** the expired-session line gets `role="status"`.
- **S3 decided differently:** the PIN field keeps `autocomplete="off"`, because the kitchen phone is shared and a saved PIN there would
  be exposed. Paste stays allowed (`autocomplete="off"` does not block it). This closes **Q-UX21** as "paste allowed, no autofill".
- **S4 later:** not before go-live.

The original proposals, for the record:

| # | Proposal | Why | Cost |
|---|---|---|---|
| S1 | **Send the PIN on the 4th digit**; keep "Entra" for keyboards and assistive tech | Waiters sign in every shift, often one-handed: 1 tap fewer per sign-in. A wrong PIN already costs one attempt either way | S: `pin-pad.tsx` + a component test |
| S2 | The "session expired" line becomes `role="status"` like the revoked notice | Screen readers hear why they are on the sign-in page (WCAG 4.1.3) | XS |
| S3 | Close the open question **Q-UX21** (WCAG 2.2 SC 3.3.8, accessible authentication) for **waiters**: they have no e-mail login, so the "alternative method" exception does not apply to them; the PIN field must therefore allow paste and password-manager autofill (a "mechanism"). Check that `autocomplete="off"` does not block a password manager on iOS and Android, or switch it to `autocomplete="current-password"` | Conformance for the role that signs in most | S: a test plus a manual check on two phones |
| S4 | On the staff list, more than ~8 people: a name filter above the list (`name-filter.tsx` exists) | A long list on a shared kitchen phone; not needed for the osteria today | S, later |

## 8. Reuse for go-to-market

These screens are the first Costì a prospect sees. For sales material use the owner view (§3) and the staff view (§4) at 360 × 740,
light, with the **placeholder logo replaced** by the founder's files first (BRAND-1). Do not show a real person's name in the staff list:
use the demo tenant's names.
