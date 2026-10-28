import { describe, expect, it } from "vitest";
import { t } from "@/lib/i18n";
import { currentSection } from "@/lib/nav/nav-model";
import { firstSteps, todayActions } from "@/lib/nav/today-actions";

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
