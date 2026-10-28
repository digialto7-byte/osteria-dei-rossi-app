import { describe, expect, it } from "vitest";
import { t } from "@/lib/i18n";
import { currentSection } from "@/lib/nav/nav-model";
import {
  allStepsDone,
  badgeFor,
  firstSteps,
  stepStatuses,
  todayActions,
} from "@/lib/nav/today-actions";

const ROLES = ["owner", "admin", "chef", "waiter"] as const;
const words = (role: (typeof ROLES)[number], locale: "it" | "en" = "it") =>
  todayActions(role)
    .flatMap((a) => [t(a.labelKey, {}, locale), t(a.hintKey, {}, locale)])
    .join(" | ");

describe("todayActions", () => {
  it.each(["owner", "admin", "chef"] as const)(
    "gives the %s exactly one primary, first",
    (role) => {
      const actions = todayActions(role);
      expect(actions.filter((a) => a.primary)).toHaveLength(1);
      expect(actions[0]!.primary).toBe(true);
    },
  );

  it("starts the owner with Carica una fattura, to /fatture", () => {
    const first = todayActions("owner")[0]!;
    expect(t(first.labelKey)).toBe("Carica una fattura");
    expect(first.href).toBe("/fatture");
  });

  it("lists the owner's actions in order", () => {
    expect(todayActions("owner").map((a) => a.href)).toEqual([
      "/fatture",
      "/avvisi",
      "/cucina",
      "/pagamenti",
      "/costi",
      "/tavoli",
      "/menu",
    ]);
  });

  it("starts the admin with the staff and devices, and gives no alerts", () => {
    const actions = todayActions("admin");
    expect(t(actions[0]!.labelKey)).toBe("Personale e dispositivi");
    expect(actions.map((a) => a.href)).toEqual([
      "/personale",
      "/anagrafiche/importa",
      "/menu",
      "/tavoli",
      "/cucina",
      "/fatture",
    ]);
  });

  it("starts the chef with a new production and keeps the kitchen jobs", () => {
    const actions = todayActions("chef");
    expect(actions[0]!.href).toBe("/produzione/nuova");
    expect(actions.map((a) => a.href)).toEqual([
      "/produzione/nuova",
      "/cucina",
      "/avvisi",
      "/magazzino/conteggi",
      "/magazzino",
      "/produzione/personale",
    ]);
  });

  it("gives the chef no money pages and no euro sign in any language", () => {
    const hrefs = todayActions("chef").map((a) => a.href);
    for (const forbidden of ["/pagamenti", "/costi", "/fatture", "/menu", "/tavoli"]) {
      expect(hrefs).not.toContain(forbidden);
    }
    for (const locale of ["it", "en"] as const) {
      expect(words("chef", locale)).not.toMatch(
        /€|\beuro\b|\bEUR\b|prezz|cost|pagament|price|payment/i,
      );
    }
  });

  it("gives the waiter nothing: the waiter is sent to the tables", () => {
    expect(todayActions("waiter")).toEqual([]);
  });

  it("gives an unknown role nothing", () => {
    expect(todayActions("guest" as never)).toEqual([]);
  });

  it("words every action in Italian and English", () => {
    for (const role of ROLES) {
      for (const action of todayActions(role)) {
        for (const locale of ["it", "en"] as const) {
          expect(t(action.labelKey, {}, locale).trim()).not.toBe("");
          expect(t(action.hintKey, {}, locale).trim()).not.toBe("");
        }
      }
    }
  });

  it("only leads to pages inside the role's own navigation", () => {
    for (const role of ["owner", "admin", "chef"] as const) {
      for (const action of todayActions(role)) {
        expect(currentSection(role, action.href), `${role} ${action.href}`).not.toBeNull();
      }
    }
  });
});

describe("firstSteps (set-up list for the owner and admin)", () => {
  it.each(["owner", "admin"] as const)("gives the %s six steps in order", (role) => {
    expect(firstSteps(role).map((s) => s.href)).toEqual([
      "/anagrafiche/ubicazioni",
      "/anagrafiche/fornitori",
      "/anagrafiche/ingredienti",
      "/fatture",
      "/personale",
      "/tavoli",
    ]);
  });

  it.each(["chef", "waiter"] as const)("gives the %s none", (role) => {
    expect(firstSteps(role)).toEqual([]);
  });

  it("never repeats the words of a main action, so a link name stays unique on the page", () => {
    for (const role of ["owner", "admin"] as const) {
      const actionLabels = todayActions(role).map((a) => t(a.labelKey));
      for (const step of firstSteps(role)) expect(actionLabels).not.toContain(t(step.labelKey));
    }
  });
});

// B3: the badges and the set-up progress from GET /api/today.
describe("badgeFor", () => {
  const card = (key: string, count: number, more = false) =>
    ({ key, count, more, href: "/x" }) as never;
  const action = (role: (typeof ROLES)[number], href: string) =>
    todayActions(role).find((a) => a.href === href)!;
  const text = (badge: ReturnType<typeof badgeFor>, locale: "it" | "en" = "it") =>
    badge ? t(badge.labelKey, { count: badge.count ?? 0 }, locale) : null;

  it("says how many invoices wait for review on Carica una fattura", () => {
    const badge = badgeFor(action("owner", "/fatture"), [card("invoicesToReview", 2)]);
    expect(text(badge)).toBe("Fatture da rivedere · 2");
    expect(badge?.tone).toBe("warning");
  });

  it("says Niente da fare when the count is 0", () => {
    const badge = badgeFor(action("owner", "/fatture"), [card("invoicesToReview", 0)]);
    expect(text(badge)).toBe("Niente da fare");
    expect(badge?.tone).toBe("neutral");
  });

  it("gives no badge when the payload has no card for the action (loading or another role)", () => {
    expect(badgeFor(action("owner", "/fatture"), [])).toBeNull();
    expect(badgeFor(action("owner", "/fatture"), [card("alerts", 3)])).toBeNull();
  });

  it("gives no badge to an action without a card (Costi, Tavoli, Menu)", () => {
    for (const href of ["/costi", "/tavoli", "/menu"]) {
      expect(badgeFor(action("owner", href), [card("alerts", 3)]), href).toBeNull();
    }
  });

  it("alerts: the count, or 'o più' when the count stopped at the cap", () => {
    expect(text(badgeFor(action("owner", "/avvisi"), [card("alerts", 3)]))).toBe(
      "Avvisi da vedere · 3",
    );
    expect(text(badgeFor(action("owner", "/avvisi"), [card("alerts", 50, true)]))).toBe(
      "Avvisi da vedere · 50 o più",
    );
  });

  it("payments: overdue first, else what is unpaid, else nothing to do", () => {
    const payables = action("owner", "/pagamenti");
    const both = [card("payablesOverdue", 1), card("payablesUnpaid", 4)];
    expect(text(badgeFor(payables, both))).toBe("Pagamenti scaduti · 1");
    expect(badgeFor(payables, both)?.tone).toBe("danger");
    expect(text(badgeFor(payables, [card("payablesOverdue", 0), card("payablesUnpaid", 4)]))).toBe(
      "Da pagare · 4",
    );
    expect(text(badgeFor(payables, [card("payablesOverdue", 0), card("payablesUnpaid", 0)]))).toBe(
      "Niente da fare",
    );
  });

  it("the chef: lots about to expire on Nuova produzione, the count in progress on the daily count", () => {
    expect(text(badgeFor(action("chef", "/produzione/nuova"), [card("batchesUseBy", 1)]))).toBe(
      "Lotti in scadenza · 1",
    );
    expect(text(badgeFor(action("chef", "/magazzino/conteggi"), [card("countOpen", 1)]))).toBe(
      "Conteggio in corso",
    );
    expect(text(badgeFor(action("chef", "/magazzino/conteggi"), [card("countOpen", 0)]))).toBe(
      "Niente da fare",
    );
  });

  it("every badge word exists in English too and carries no euro sign", () => {
    const all = [
      ...todayActions("owner"),
      ...todayActions("admin"),
      ...todayActions("chef"),
    ].flatMap((a) =>
      [
        "invoicesToReview",
        "alerts",
        "payablesOverdue",
        "payablesUnpaid",
        "batchesUseBy",
        "countOpen",
      ]
        .map((key) => badgeFor(a, [card(key, 2)]))
        .filter((b) => b !== null),
    );
    expect(all.length).toBeGreaterThan(0);
    for (const badge of all) {
      expect(text(badge, "en")).not.toMatch(/\{|€/);
      expect(text(badge, "it")).not.toMatch(/\{|€/);
    }
  });
});

describe("stepStatuses", () => {
  const step = (key: string, done: boolean) => ({ key, done, href: "/x" }) as never;
  const ALL_OPEN = [
    "locations",
    "suppliers",
    "ingredients",
    "invoice",
    "staff",
    "device",
    "tables",
    "menu",
  ].map((key) => step(key, false));
  const doneKeys = (...keys: string[]) =>
    ALL_OPEN.map((s: { key: string }) => step(s.key, keys.includes(s.key)));

  it("keeps the six steps of Primi passi, in order, for the owner and the admin", () => {
    for (const role of ["owner", "admin"]) {
      expect(stepStatuses(role, ALL_OPEN).map((s) => s.href)).toEqual(
        firstSteps(role).map((s) => s.href),
      );
    }
  });

  it("marks a step done from the matching keys, and Personale only when staff and a device exist", () => {
    const done = (keys: string[]) =>
      stepStatuses("owner", doneKeys(...keys)).map((s) => [t(s.labelKey), s.done]);
    expect(done(["locations", "invoice"])).toEqual([
      ["Ubicazioni", true],
      ["Fornitori", false],
      ["Ingredienti", false],
      ["Carica la prima fattura", true],
      ["Aggiungi il personale", false],
      ["Imposta tavoli e menu", false],
    ]);
    expect(done(["staff"])[4]![1]).toBe(false);
    expect(done(["device"])[4]![1]).toBe(false);
    expect(done(["staff", "device"])[4]![1]).toBe(true);
    expect(done(["tables"])[5]![1]).toBe(false);
    expect(done(["tables", "menu"])[5]![1]).toBe(true);
  });

  it("is empty for the chef and the waiter, and for a null list", () => {
    expect(stepStatuses("chef", null)).toEqual([]);
    expect(stepStatuses("waiter", ALL_OPEN)).toEqual([]);
  });

  it("without the API list the steps are shown with no state (done is null)", () => {
    const steps = stepStatuses("owner", null);
    expect(steps).toHaveLength(6);
    expect(steps.every((s) => s.done === null)).toBe(true);
  });

  it("allStepsDone is true only when every step is done", () => {
    const every = stepStatuses(
      "owner",
      ALL_OPEN.map((s: { key: string }) => step(s.key, true)),
    );
    expect(allStepsDone(every)).toBe(true);
    expect(allStepsDone(stepStatuses("owner", doneKeys("locations")))).toBe(false);
    expect(allStepsDone(stepStatuses("owner", null))).toBe(false);
    expect(allStepsDone([])).toBe(false);
  });
});
