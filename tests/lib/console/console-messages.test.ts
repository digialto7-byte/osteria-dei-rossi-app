import { describe, expect, it } from "vitest";
import { messages, t, tn } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";

// SP3 step 18, step 1: the console strings. Values quoted from the UX (docs/ux/costi-console.md) are pinned verbatim;
// the ones marked "(da approvare)" in the plan are pinned too, so a change is a decision.

const VERBATIM: [MessageKey, string][] = [
  ["console.tabTitle", "Costì · Console"],
  ["console.nav.label", "Console"],
  ["console.nav.locali", "Locali"],
  ["console.nav.registro", "Registro"],
  ["console.nav.avvisi", "Avvisi"],
  ["console.footer.mfa", "Verifica in due passaggi attiva"],
  ["console.footer.times", "Orari: ora italiana"],
  ["console.unavailable", "La console non risponde. Riprova tra poco."],
  ["console.noAccess", "Questo account non ha accesso alla console."],
  ["console.signIn.title", "Console"],
  ["console.signIn.intro", "Accesso riservato a DigiAlto."],
  ["console.code.continue", "Per continuare inserisci il codice."],
  ["console.day.today", "oggi"],
  ["console.day.yesterday", "ieri"],
  ["console.yes", "Sì"],
  ["console.no", "No"],
  ["console.locali.title", "Locali"],
  ["console.locali.search", "Cerca un locale…"],
  ["console.locali.col.name", "Locale"],
  ["console.locali.col.group", "Gruppo"],
  ["console.locali.col.activity", "Ultima attività"],
  ["console.locali.col.digialto", "DigiAlto"],
  ["console.locali.people.one", "{count} persona"],
  ["console.locali.people.other", "{count} persone"],
  ["console.locali.shown.one", "Mostro {count} locale."],
  ["console.locali.shown.other", "Mostro {count} locali."],
  ["console.locali.shownOf", "Mostro {n} di {totale} locali."],
  ["console.locali.noMatch", "Nessun locale con questi filtri."],
  ["console.locali.clearFilters", "Togli i filtri"],
  ["console.locali.readError", "Non riesco a leggere i locali."],
  ["console.locali.unread.one", "{count} avviso da leggere"],
  ["console.locali.unread.other", "{count} avvisi da leggere"],
  ["console.locali.digialtoMeta.yes", "DigiAlto: sì"],
  ["console.locali.digialtoMeta.no", "DigiAlto: no"],
  ["console.detail.back", "Locali"],
  ["console.detail.noGroup", "nessun gruppo"],
  ["console.createdOn", "creato il {date}"],
  ["console.detail.attached", "DigiAlto collegato"],
  ["console.detail.health.title", "Salute"],
  ["console.detail.health.notAttached", "DigiAlto non è collegato a questo locale."],
  ["console.detail.usage.title", "Utilizzo"],
  ["console.detail.usage.people", "Persone"],
  ["console.detail.usage.digialto", "DigiAlto"],
  ["console.detail.usage.nobody", "nessuno"],
  ["console.role.owner.one", "{count} titolare"],
  ["console.role.owner.other", "{count} titolari"],
  ["console.role.admin.one", "{count} admin"],
  ["console.role.admin.other", "{count} admin"],
  ["console.role.chef.one", "{count} cuoco"],
  ["console.role.chef.other", "{count} cuochi"],
  ["console.role.waiter.one", "{count} cameriere"],
  ["console.role.waiter.other", "{count} camerieri"],
  ["console.detail.activity.title", "Attività di DigiAlto"],
  ["console.detail.activity.all", "Vedi tutto nel registro ›"],
  ["console.detail.activity.empty", "Nessuna attività di DigiAlto."],
  ["console.detail.settings.title", "Impostazioni"],
  ["console.detail.settings.name", "Nome del locale"],
  ["console.detail.settings.timeZone", "Fuso orario"],
  ["console.detail.settings.bookingSlug", "Pagina prenotazioni"],
  ["console.detail.notFound", "Locale non trovato."],
  ["console.detail.readError", "Non riesco a leggere il locale."],
  ["console.audit.title", "Registro della piattaforma"],
  ["console.audit.filter.locale", "Locale"],
  ["console.audit.filter.allLocali", "Tutti"],
  ["console.audit.filter.action", "Azione"],
  ["console.audit.filter.allActions", "Tutte"],
  ["console.audit.filter.from", "Dal"],
  ["console.audit.filter.to", "Al"],
  ["console.audit.rangeOrder", "La data iniziale è dopo quella finale."],
  ["console.audit.rangeSpan", "Il periodo può durare al massimo 366 giorni."],
  ["console.audit.col.when", "Quando"],
  ["console.audit.col.place", "Locale"],
  ["console.audit.col.action", "Azione"],
  ["console.audit.col.origin", "Da"],
  ["console.audit.origin.console", "Console"],
  ["console.audit.origin.script", "Script"],
  ["console.audit.more", "Carica altri"],
  ["console.audit.empty", "Nessuna azione in questo periodo."],
  ["console.audit.readError", "Non riesco a leggere il registro."],
  ["console.audit.detail.title", "Dettaglio"],
  ["console.audit.detail.close", "Chiudi"],
  ["console.rawCode", "codice: {code}"],
  ["console.audit.erasedPlace", "Locale cancellato"],
  ["console.notices.title", "Avvisi"],
  ["console.notices.tab.unread", "Da leggere"],
  ["console.notices.tab.read", "Letti"],
  [
    "console.notices.subprocessor.one",
    "Nuovo sub-responsabile v{version}: {count} locale non ancora avvisato",
  ],
  [
    "console.notices.subprocessor.other",
    "Nuovo sub-responsabile v{version}: {count} locali non ancora avvisati",
  ],
  [
    "console.notices.subprocessor.done",
    "Nuovo sub-responsabile v{version}: tutti i locali avvisati",
  ],
  ["console.notices.mark", "Segna come avvisato"],
  ["console.notices.notified", "Avvisato il {date}"],
  ["console.notices.emptyUnread", "Nessun avviso da leggere."],
  ["console.notices.emptyRead", "Nessun avviso letto."],
  ["console.notices.readError", "Non riesco a leggere gli avvisi."],
  ["console.notices.markError", "Non riesco a segnare questo locale come avvisato."],
  ["mfa.account.noFactor", "Attiva prima la verifica in due passaggi dalla console."],
];

const AUDIT_ACTIONS = [
  "platform_admin.bootstrapped",
  "platform_admin.factor_enrolled",
  "console.entered",
  "console.left",
  "console.tenant_opened",
  "notice.created",
  "notice.tenant_notified",
  "script.create_tenant",
  "script.mfa_reset",
  "script.set_mfa_enforcement",
];

describe("console.* strings", () => {
  it("t('console.signIn.intro') is «Accesso riservato a DigiAlto.»", () => {
    expect(t("console.signIn.intro")).toBe("Accesso riservato a DigiAlto.");
  });

  it.each(VERBATIM)("%s is pinned verbatim", (key, value) => {
    expect(messages.it[key]).toBe(value);
  });

  it("has a sentence key for each of the ten audit codes", () => {
    expect(AUDIT_ACTIONS).toHaveLength(10);
    for (const code of AUDIT_ACTIONS) {
      const key = `console.audit.action.${code}` as MessageKey;
      expect(messages.it[key], key).toBeTruthy();
    }
  });

  it("gives every plural both .one and .other", () => {
    const keys = Object.keys(messages.it).filter((k) => k.startsWith("console."));
    for (const key of keys) {
      if (key.endsWith(".one")) expect(keys, key).toContain(key.replace(/\.one$/, ".other"));
      if (key.endsWith(".other")) expect(keys, key).toContain(key.replace(/\.other$/, ".one"));
    }
  });

  it("has every console key in English too, non-empty", () => {
    const keys = [
      ...Object.keys(messages.it).filter((k) => k.startsWith("console.")),
      "mfa.account.noFactor",
    ];
    for (const key of keys) expect(messages.en[key as MessageKey], key).toBeTruthy();
  });

  it("holds no e-mail address in any console value, either language", () => {
    for (const locale of ["it", "en"] as const) {
      for (const [key, value] of Object.entries(messages[locale])) {
        if (key.startsWith("console.")) expect(value, key).not.toContain("@");
      }
    }
  });

  it("fills counts through tn", () => {
    expect(tn("console.locali.people", 1)).toBe("1 persona");
    expect(tn("console.locali.people", 4)).toBe("4 persone");
  });
});
