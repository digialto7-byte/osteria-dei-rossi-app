import { describe, expect, it } from "vitest";
import { t } from "@/lib/i18n";
import {
  currentGroup,
  currentSection,
  isFocusRoute,
  landingFor,
  navFor,
  type GroupKey,
} from "@/lib/nav/nav-model";

const ROLES = ["owner", "admin", "chef", "waiter"] as const;
const ID = "5b0c9f0e-1c1d-4b5e-9d5a-0a1b2c3d4e5f";

/** Expected sections per role, group by group, in order (plan 3.1.2). */
const EXPECTED: Record<(typeof ROLES)[number], Record<string, string[]>> = {
  owner: {
    oggi: ["/", "/avvisi"],
    acquisti: ["/fatture", "/pagamenti", "/anagrafiche/fornitori"],
    cucina: ["/cucina", "/produzione", "/magazzino", "/riordino", "/ricette"],
    sala: ["/tavoli", "/menu"],
    gestione: [
      "/costi",
      "/registro",
      "/personale",
      "/anagrafiche/ingredienti",
      "/anagrafiche/ubicazioni",
      "/anagrafiche/importa",
    ],
  },
  admin: {
    oggi: ["/"],
    acquisti: ["/fatture", "/pagamenti", "/anagrafiche/fornitori"],
    cucina: ["/cucina", "/produzione", "/magazzino", "/riordino", "/ricette"],
    sala: ["/tavoli", "/menu"],
    gestione: [
      "/costi",
      "/registro",
      "/personale",
      "/anagrafiche/ingredienti",
      "/anagrafiche/ubicazioni",
      "/anagrafiche/importa",
    ],
  },
  chef: {
    oggi: ["/", "/avvisi"],
    cucina: ["/cucina", "/produzione", "/magazzino", "/riordino", "/ricette", "/margini"],
    gestione: ["/anagrafiche/ingredienti"],
  },
  waiter: { sala: ["/tavoli"] },
};

const asTable = (role: (typeof ROLES)[number]) =>
  Object.fromEntries(navFor(role).map((g) => [g.key, g.sections.map((s) => s.href)]));

describe("navFor", () => {
  it.each(ROLES)("returns exactly the sections of the plan table for the %s", (role) => {
    expect(asTable(role)).toEqual(EXPECTED[role]);
  });

  it.each(ROLES)("keeps the fixed group order for the %s", (role) => {
    const order: GroupKey[] = ["oggi", "acquisti", "cucina", "sala", "gestione"];
    const keys = navFor(role).map((g) => g.key);
    expect(keys).toEqual(order.filter((k) => keys.includes(k)));
  });

  it.each(ROLES)("gives the %s at most 5 groups and no empty group", (role) => {
    const groups = navFor(role);
    expect(groups.length).toBeLessThanOrEqual(5);
    for (const group of groups) expect(group.sections.length).toBeGreaterThan(0);
  });

  it("gives the waiter only Sala > Tavoli", () => {
    expect(asTable("waiter")).toEqual({ sala: ["/tavoli"] });
  });

  it("gives the chef no invoices, payables, costs, import, tables or menu", () => {
    const hrefs = Object.values(asTable("chef")).flat();
    for (const forbidden of [
      "/fatture",
      "/pagamenti",
      "/costi",
      "/anagrafiche/importa",
      "/tavoli",
      "/menu",
    ]) {
      expect(hrefs).not.toContain(forbidden);
    }
  });

  it("gives Margini to the chef only, and Avvisi to owner and chef only", () => {
    for (const role of ROLES) {
      const hrefs = Object.values(asTable(role)).flat();
      expect(hrefs.includes("/margini")).toBe(role === "chef");
      expect(hrefs.includes("/avvisi")).toBe(role === "owner" || role === "chef");
    }
  });

  it("opens each group on its first section", () => {
    for (const role of ROLES) {
      for (const group of navFor(role)) expect(group.landing).toBe(group.sections[0]!.href);
    }
  });

  it("words every group and section in Italian and English", () => {
    for (const group of navFor("owner")) {
      expect(t(group.labelKey).trim()).not.toBe("");
      expect(t(group.labelKey, {}, "en").trim()).not.toBe("");
      for (const section of group.sections) expect(t(section.labelKey).trim()).not.toBe("");
    }
  });

  it("returns nothing for an unknown role", () => {
    expect(navFor("guest" as never)).toEqual([]);
  });
});

describe("currentGroup and currentSection", () => {
  it("marks /dispositivi as Gestione > Personale", () => {
    expect(currentGroup("owner", "/dispositivi")).toBe("gestione");
    expect(currentSection("owner", "/dispositivi")?.href).toBe("/personale");
  });

  it("marks /costi/ricette/x as Costi", () => {
    expect(currentGroup("owner", "/costi/ricette/x")).toBe("gestione");
    expect(currentSection("owner", "/costi/ricette/x")?.href).toBe("/costi");
  });

  it("marks the supplier detail as Acquisti > Fornitori and the ingredient list as Gestione", () => {
    expect(currentGroup("owner", "/anagrafiche/fornitori/abc")).toBe("acquisti");
    expect(currentGroup("owner", "/anagrafiche/ingredienti")).toBe("gestione");
  });

  it("marks Oggi only on /", () => {
    expect(currentGroup("owner", "/")).toBe("oggi");
    expect(currentSection("owner", "/")?.href).toBe("/");
    expect(currentSection("owner", "/fatture")?.href).toBe("/fatture");
  });

  it("marks the sub-pages of a section as that section", () => {
    expect(currentSection("owner", "/tavoli/impostazioni")?.href).toBe("/tavoli");
    expect(currentSection("chef", "/magazzino/conteggi")?.href).toBe("/magazzino");
    expect(currentSection("chef", "/riordino/fornitori")?.href).toBe("/riordino");
  });

  it("returns null for a path the role has no section for", () => {
    expect(currentGroup("chef", "/pagamenti")).toBeNull();
    expect(currentSection("chef", "/pagamenti")).toBeNull();
    expect(currentGroup("waiter", "/fatture")).toBeNull();
    expect(currentGroup("owner", "/impostazioni/dati-di-prova")).toBeNull();
  });

  it("marks exactly one section per path", () => {
    for (const role of ROLES) {
      for (const group of navFor(role)) {
        for (const section of group.sections) {
          const hits = navFor(role)
            .flatMap((g) => g.sections)
            .filter((s) => currentSection(role, section.href)?.href === s.href);
          expect(hits).toHaveLength(1);
        }
      }
    }
  });
});

describe("Comande (M19, /cucina)", () => {
  it.each(["owner", "admin", "chef"] as const)(
    "is the first section of Cucina for the %s",
    (role) => {
      const cucina = navFor(role).find((g) => g.key === "cucina")!;
      expect(cucina.sections[0]!.href).toBe("/cucina");
      expect(t(cucina.sections[0]!.labelKey)).toBe("Comande");
      // The group tab leads to the tickets.
      expect(cucina.landing).toBe("/cucina");
    },
  );

  it("is not a section of the waiter", () => {
    expect(navFor("waiter").flatMap((g) => g.sections.map((s) => s.href))).not.toContain("/cucina");
    expect(currentSection("waiter", "/cucina")).toBeNull();
  });

  it("marks /cucina as Cucina > Comande for the chef", () => {
    expect(currentGroup("chef", "/cucina")).toBe("cucina");
    expect(currentSection("chef", "/cucina")?.href).toBe("/cucina");
  });

  it("is not a focus route: the chef keeps the navigation (the way back and Esci)", () => {
    expect(isFocusRoute("/cucina")).toBe(false);
    expect(isFocusRoute("/cucina/")).toBe(false);
  });
});

describe("isFocusRoute", () => {
  it("is true for a comanda and a count in progress", () => {
    expect(isFocusRoute(`/tavoli/${ID}`)).toBe(true);
    expect(isFocusRoute(`/tavoli/${ID}/`)).toBe(true);
    expect(isFocusRoute("/tavoli/comanda")).toBe(true);
    expect(isFocusRoute("/tavoli/comanda/")).toBe(true);
    expect(isFocusRoute(`/magazzino/conteggi/${ID}`)).toBe(true);
  });

  it("is false for the pages around them", () => {
    for (const path of [
      "/",
      "/tavoli",
      "/tavoli/impostazioni",
      "/tavoli/comandaa",
      "/tavoli/comanda/extra",
      "/magazzino/conteggi",
      "/magazzino/conteggi/critici",
      `/magazzino/conteggi/${ID}/scostamenti`,
      `/magazzino/${ID}`,
      `/produzione/${ID}`,
    ]) {
      expect(isFocusRoute(path), path).toBe(false);
    }
  });
});

describe("landingFor", () => {
  it("sends the waiter to the tables and everyone else to Oggi", () => {
    expect(landingFor("waiter")).toBe("/tavoli");
    for (const role of ["owner", "admin", "chef"] as const) expect(landingFor(role)).toBe("/");
  });
});
