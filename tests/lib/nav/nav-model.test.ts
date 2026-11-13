import { describe, expect, it } from "vitest";
import { t } from "@/lib/i18n";
import {
  currentGroup,
  currentSection,
  currentTab,
  isFocusRoute,
  landingFor,
  navFor,
  overflowGroups,
  phoneTabs,
  tabsForGroups,
  type GroupKey,
  type NavGroup,
} from "@/lib/nav/nav-model";

const ROLES = ["owner", "admin", "chef", "waiter"] as const;
const ID = "5b0c9f0e-1c1d-4b5e-9d5a-0a1b2c3d4e5f";

// M25b (plan §3.1.2, ADR-030): this list spells out the navigation and was rewritten on purpose for the six groups. Order inside a
// group is the order here. Every gate is the one the href had before M25b, so the only new href is /sicurezza (owner and admin).
// P2-1 B5 adds /doppia-verifica ("Verifica in due passaggi", owner and admin) in Registro, next to /sicurezza, on purpose.
const OWNER_GROUPS: Record<string, string[]> = {
  home: ["/", "/avvisi", "/spingere"],
  gestione: ["/fatture", "/pagamenti"],
  cucina: ["/cucina", "/produzione", "/magazzino", "/riordino"],
  sala: ["/tavoli", "/prenotazioni", "/menu"],
  anagrafica: [
    "/anagrafiche/ubicazioni",
    "/ricette",
    "/anagrafiche/fornitori",
    "/anagrafiche/ingredienti",
    "/personale",
    "/anagrafiche/importa",
  ],
  registro: ["/sicurezza", "/doppia-verifica", "/costi", "/chiusura", "/report", "/registro"],
};

const EXPECTED: Record<(typeof ROLES)[number], Record<string, string[]>> = {
  owner: OWNER_GROUPS,
  admin: { ...OWNER_GROUPS, home: ["/", "/spingere"] },
  chef: {
    home: ["/", "/avvisi", "/spingere"],
    cucina: ["/cucina", "/produzione", "/magazzino", "/riordino", "/margini"],
    anagrafica: ["/ricette", "/anagrafiche/ingredienti"],
  },
  waiter: { sala: ["/tavoli", "/prenotazioni"] },
};

// The href sets of main 0f1df68 (plan §2.3, before M25b). "Never widen": each role gets these, plus /sicurezza for owner and admin.
const BEFORE_M25B_OWNER = [
  "/",
  "/avvisi",
  "/spingere",
  "/fatture",
  "/pagamenti",
  "/anagrafiche/fornitori",
  "/cucina",
  "/produzione",
  "/magazzino",
  "/riordino",
  "/ricette",
  "/tavoli",
  "/menu",
  "/chiusura",
  "/report",
  "/costi",
  "/registro",
  "/personale",
  "/anagrafiche/ingredienti",
  "/anagrafiche/ubicazioni",
  "/anagrafiche/importa",
];
const BEFORE_M25B: Record<(typeof ROLES)[number], string[]> = {
  owner: BEFORE_M25B_OWNER,
  admin: BEFORE_M25B_OWNER.filter((h) => h !== "/avvisi"),
  chef: [
    "/",
    "/avvisi",
    "/spingere",
    "/cucina",
    "/produzione",
    "/magazzino",
    "/riordino",
    "/ricette",
    "/margini",
    "/anagrafiche/ingredienti",
  ],
  waiter: ["/tavoli"],
};

const asTable = (role: (typeof ROLES)[number]) =>
  Object.fromEntries(navFor(role).map((g) => [g.key, g.sections.map((s) => s.href)]));

describe("navFor", () => {
  it.each(ROLES)("returns exactly the sections of the plan table for the %s", (role) => {
    expect(asTable(role)).toEqual(EXPECTED[role]);
  });

  it.each(ROLES)("keeps the fixed group order for the %s", (role) => {
    const order: GroupKey[] = ["home", "gestione", "cucina", "sala", "anagrafica", "registro"];
    const keys = navFor(role).map((g) => g.key);
    expect(keys).toEqual(order.filter((k) => keys.includes(k)));
  });

  it.each(ROLES)("gives the %s at most 6 groups, 6 sections a group and no empty group", (role) => {
    const groups = navFor(role);
    expect(groups.length).toBeLessThanOrEqual(6);
    for (const group of groups) {
      expect(group.sections.length).toBeGreaterThan(0);
      // The phone row fits 6 pills; a seventh in Anagrafica must be a conscious choice (plan §3.8).
      expect(group.sections.length).toBeLessThanOrEqual(6);
    }
  });

  it.each(ROLES)(
    "never widens what the %s sees (plan §2.3 plus /sicurezza, /doppia-verifica and, in Sala, /prenotazioni)",
    (role) => {
      const hrefs = Object.values(asTable(role)).flat().sort();
      // /prenotazioni (reservations A13) is Sala for owner, admin and waiter, the roles of the day view; the chef never gets it.
      const extra = [
        ...(role === "owner" || role === "admin" ? ["/sicurezza", "/doppia-verifica"] : []),
        ...(role === "chef" ? [] : ["/prenotazioni"]),
      ];
      expect(hrefs).toEqual([...BEFORE_M25B[role], ...extra].sort());
    },
  );

  it("gives the owner 24 links in six groups", () => {
    expect(Object.values(asTable("owner")).flat()).toHaveLength(24);
    expect(Object.keys(asTable("owner"))).toHaveLength(6);
  });

  it("names no section like a group, so 'Registro' is never both (Home > Home is the one planned pair)", () => {
    for (const role of ROLES) {
      const groups = navFor(role);
      const groupLabels = groups.map((g) => t(g.labelKey));
      // The Home page's own pill reads "Home" under the group "Home" (plan §3.1.2, Q211): the one allowed pair.
      for (const section of groups.flatMap((g) => g.sections).filter((x) => x.href !== "/")) {
        expect(groupLabels, `${role} ${section.href}`).not.toContain(t(section.labelKey));
      }
    }
  });

  it("words the groups and the changed labels in Italian and English", () => {
    expect(navFor("owner").map((g) => t(g.labelKey))).toEqual([
      "Home",
      "Gestione",
      "Cucina",
      "Sala",
      "Anagrafica",
      "Registro",
    ]);
    expect(navFor("owner").map((g) => t(g.labelKey, {}, "en"))).toEqual([
      "Home",
      "Management",
      "Kitchen",
      "Floor",
      "Master data",
      "Records",
    ]);
    expect(t("nav.today")).toBe("Home");
    expect(t("nav.audit")).toBe("Attività");
    expect(t("nav.audit", {}, "en")).toBe("Activity");
    expect(t("nav.more")).toBe("Altro");
    expect(t("nav.more", {}, "en")).toBe("More");
    expect(t("nav.safety")).toBe("Sicurezza");
  });

  it("gives the waiter only Sala > Tavoli and Prenotazioni", () => {
    expect(asTable("waiter")).toEqual({ sala: ["/tavoli", "/prenotazioni"] });
  });

  it("gives Prenotazioni (reservations A13) to owner, admin and waiter, in Sala next to Tavoli; never to the chef", () => {
    for (const role of ROLES) {
      const hrefs = Object.values(asTable(role)).flat();
      expect(hrefs.includes("/prenotazioni"), role).toBe(role !== "chef");
    }
    expect(asTable("owner").sala).toEqual(["/tavoli", "/prenotazioni", "/menu"]);
    expect(t("nav.reservations")).toBe("Prenotazioni");
    expect(t("nav.reservations", {}, "en")).toBe("Reservations");
    for (const role of ["owner", "admin", "waiter"] as const) {
      expect(currentSection(role, "/prenotazioni")?.href, role).toBe("/prenotazioni");
      expect(currentGroup(role, "/prenotazioni"), role).toBe("sala");
      expect(currentTab(role, "/prenotazioni"), role).toBe("sala");
    }
    expect(currentSection("waiter", "/prenotazioni")?.labelKey).toBe("nav.reservations");
    expect(currentSection("chef", "/prenotazioni")).toBeNull();
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
      "/chiusura",
      "/report",
    ]) {
      expect(hrefs).not.toContain(forbidden);
    }
  });

  it("gives Chiusura (the end of the day, M21) to owner and admin only, in Registro", () => {
    for (const role of ROLES) {
      const hrefs = Object.values(asTable(role)).flat();
      expect(hrefs.includes("/chiusura"), role).toBe(role === "owner" || role === "admin");
    }
    expect(asTable("owner").registro).toContain("/chiusura");
    expect(t("nav.dayClose")).toBe("Chiusura");
    expect(currentSection("owner", "/chiusura")?.href).toBe("/chiusura");
    // M25a: /password is a signed-in page that belongs to no section (it is reached from the account card on Oggi).
    expect(currentSection("owner", "/password")).toBeNull();
    expect(currentSection("admin", "/password")).toBeNull();
    expect(currentGroup("admin", "/chiusura")).toBe("registro");
    expect(currentSection("waiter", "/chiusura")).toBeNull();
  });

  it("gives Report (the KPI reports, M22) to owner and admin only, in Registro next to Chiusura", () => {
    for (const role of ROLES) {
      const hrefs = Object.values(asTable(role)).flat();
      expect(hrefs.includes("/report"), role).toBe(role === "owner" || role === "admin");
    }
    expect(asTable("owner").registro).toContain("/report");
    expect(t("nav.reports")).toBe("Report");
    expect(currentSection("admin", "/report")?.href).toBe("/report");
    expect(currentGroup("owner", "/report")).toBe("registro");
    // M24: the monthly pack is a sub-page of Report, so Report stays the current section.
    expect(currentSection("owner", "/report/mese")?.href).toBe("/report");
    expect(currentSection("admin", "/report/mese")?.href).toBe("/report");
    expect(currentSection("chef", "/report/mese")).toBeNull();
    expect(currentSection("chef", "/report")).toBeNull();
    expect(currentSection("waiter", "/report")).toBeNull();
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
  it("marks /dispositivi as Anagrafica > Personale", () => {
    expect(currentGroup("owner", "/dispositivi")).toBe("anagrafica");
    expect(currentSection("owner", "/dispositivi")?.href).toBe("/personale");
  });

  it("marks /costi/ricette/x and /costi/impostazioni as Registro > Costi", () => {
    expect(currentGroup("owner", "/costi/ricette/x")).toBe("registro");
    expect(currentSection("owner", "/costi/ricette/x")?.href).toBe("/costi");
    expect(currentSection("owner", "/costi/impostazioni")?.href).toBe("/costi");
  });

  it("marks the supplier pages and the ingredient list as Anagrafica", () => {
    expect(currentGroup("owner", "/anagrafiche/fornitori/abc")).toBe("anagrafica");
    expect(currentSection("owner", "/anagrafiche/fornitori/abc/estratto-conto")?.href).toBe(
      "/anagrafiche/fornitori",
    );
    expect(currentGroup("owner", "/anagrafiche/ingredienti")).toBe("anagrafica");
  });

  it("marks the invoice quality page as Gestione > Fatture", () => {
    expect(currentSection("owner", "/fatture/qualita")?.href).toBe("/fatture");
    expect(currentGroup("admin", "/pagamenti/x")).toBe("gestione");
  });

  it("marks recipes and their versions as Anagrafica > Ricette, also for the chef", () => {
    expect(currentSection("owner", "/ricette/x/versioni/2")?.href).toBe("/ricette");
    expect(currentGroup("chef", "/ricette/x")).toBe("anagrafica");
    expect(currentSection("owner", "/magazzino/conteggi/critici")?.href).toBe("/magazzino");
    expect(currentSection("owner", "/report/mese")?.href).toBe("/report");
  });

  it("marks /sicurezza for the owner and the admin, not for the chef", () => {
    expect(currentSection("owner", "/sicurezza")?.href).toBe("/sicurezza");
    expect(currentSection("admin", "/sicurezza")?.href).toBe("/sicurezza");
    expect(currentSection("chef", "/sicurezza")).toBeNull();
    expect(currentSection("waiter", "/sicurezza")).toBeNull();
  });

  it("marks Home only on /", () => {
    expect(currentGroup("owner", "/")).toBe("home");
    expect(currentSection("owner", "/")?.href).toBe("/");
    expect(currentSection("owner", "/fatture")?.href).toBe("/fatture");
  });

  it("marks no section on /altro or /password", () => {
    expect(currentSection("owner", "/altro")).toBeNull();
    expect(currentSection("owner", "/password")).toBeNull();
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
  it("sends the waiter to the tables and everyone else to Home", () => {
    expect(landingFor("waiter")).toBe("/tavoli");
    for (const role of ["owner", "admin", "chef"] as const) expect(landingFor(role)).toBe("/");
  });
});

describe("Da spingere (M23)", () => {
  it("is in Home for the owner, the admin and the chef, never for the waiter", () => {
    for (const role of ROLES) {
      const oggi =
        navFor(role)
          .find((g) => g.key === "home")
          ?.sections.map((s) => s.href) ?? [];
      expect(oggi.includes("/spingere"), role).toBe(role !== "waiter");
    }
    expect(t("nav.push")).toBe("Da spingere");
    expect(t("nav.push", {}, "en")).toBe("To push");
    expect(currentSection("chef", "/spingere")?.href).toBe("/spingere");
    expect(currentGroup("owner", "/spingere")).toBe("home");
    expect(currentSection("waiter", "/spingere")).toBeNull();
  });
});

describe("phoneTabs (plan §3.1.4)", () => {
  const pairs = (role: (typeof ROLES)[number]) => phoneTabs(role).map((tab) => [tab.key, tab.href]);

  it.each(["owner", "admin"] as const)("gives the %s five tabs, the last one Altro", (role) => {
    expect(pairs(role)).toEqual([
      ["home", "/"],
      ["gestione", "/fatture"],
      ["cucina", "/cucina"],
      ["sala", "/tavoli"],
      ["altro", "/altro"],
    ]);
    expect(phoneTabs(role)[4]!.groups).toEqual(["anagrafica", "registro"]);
    expect(overflowGroups(role).map((g) => g.key)).toEqual(["anagrafica", "registro"]);
  });

  it("gives the chef three tabs and no Altro", () => {
    expect(pairs("chef")).toEqual([
      ["home", "/"],
      ["cucina", "/cucina"],
      ["anagrafica", "/ricette"],
    ]);
    expect(overflowGroups("chef")).toEqual([]);
  });

  it("gives the waiter one tab (Sala, with two sections) and no overflow", () => {
    expect(pairs("waiter")).toEqual([["sala", "/tavoli"]]);
    expect(overflowGroups("waiter")).toEqual([]);
  });

  it("flattens the owner's Altro links to the 12 of Anagrafica and Registro, in model order", () => {
    expect(overflowGroups("owner").flatMap((g) => g.sections.map((s) => s.href))).toEqual([
      ...OWNER_GROUPS.anagrafica!,
      ...OWNER_GROUPS.registro!,
    ]);
  });

  it("makes Altro only above five groups (two candidates for the threshold)", () => {
    const groups = (n: number): NavGroup[] =>
      navFor("owner")
        .slice(0, n)
        .map((g) => g);
    expect(tabsForGroups(groups(5)).map((tab) => tab.key)).toEqual([
      "home",
      "gestione",
      "cucina",
      "sala",
      "anagrafica",
    ]);
    expect(tabsForGroups(groups(4)).map((tab) => tab.key)).toEqual([
      "home",
      "gestione",
      "cucina",
      "sala",
    ]);
    expect(tabsForGroups(groups(6)).map((tab) => tab.key)).toEqual([
      "home",
      "gestione",
      "cucina",
      "sala",
      "altro",
    ]);
  });

  it("returns nothing for an unknown role", () => {
    expect(phoneTabs("guest" as never)).toEqual([]);
  });
});

describe("Verifica in due passaggi (P2-1 B5)", () => {
  it("is in the nav of the owner and the admin, labelled in Italian", () => {
    for (const role of ["owner", "admin"] as const) {
      const section = currentSection(role, "/doppia-verifica");
      expect(section?.href).toBe("/doppia-verifica");
      expect(t(section!.labelKey)).toBe("Verifica in due passaggi");
      expect(section?.group).toBe("registro");
    }
  });

  it("is not in the nav of the chef or the waiter", () => {
    for (const role of ["chef", "waiter"] as const) {
      expect(currentSection(role, "/doppia-verifica")).toBeNull();
      expect(navFor(role).flatMap((g) => g.sections.map((s) => s.href))).not.toContain(
        "/doppia-verifica",
      );
    }
  });

  it("sits in the Altro tab on the phone, like /sicurezza", () => {
    expect(currentTab("owner", "/doppia-verifica")).toBe("altro");
  });
});

describe("currentTab", () => {
  it("is Altro for pages in the overflow groups and for /altro", () => {
    for (const path of [
      "/chiusura",
      "/anagrafiche/fornitori/x/estratto-conto",
      "/dispositivi",
      "/altro",
      "/sicurezza",
    ]) {
      expect(currentTab("owner", path), path).toBe("altro");
    }
  });

  it("is the group for pages in a direct group", () => {
    expect(currentTab("owner", "/fatture/qualita")).toBe("gestione");
    expect(currentTab("owner", "/")).toBe("home");
    expect(currentTab("owner", "/tavoli/impostazioni")).toBe("sala");
  });

  it("is null outside the nav, and for /altro when the role has no Altro", () => {
    expect(currentTab("owner", "/impostazioni/dati-di-prova")).toBeNull();
    expect(currentTab("chef", "/altro")).toBeNull();
    expect(currentTab("waiter", "/altro")).toBeNull();
  });

  it("is the chef's own tab for Anagrafica pages", () => {
    expect(currentTab("chef", "/ricette/x")).toBe("anagrafica");
    expect(currentTab("chef", "/anagrafiche/ingredienti")).toBe("anagrafica");
  });
});
