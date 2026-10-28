import { describe, expect, it } from "vitest";
import { isCurrent } from "@/lib/nav/is-current";

// The old owner nav tabs (the sections of src/lib/nav/nav-model.ts): exactly one is current on each screen.
const TABS = [
  "/",
  "/fatture",
  "/pagamenti",
  "/avvisi",
  "/ricette",
  "/magazzino",
  "/produzione",
  "/riordino",
  "/costi",
  "/margini",
  "/tavoli",
  "/menu",
  "/anagrafiche/fornitori",
  "/anagrafiche/ingredienti",
  "/anagrafiche/ubicazioni",
  "/anagrafiche/importa",
];
const currentTabs = (pathname: string) => TABS.filter((href) => isCurrent(pathname, href));

describe("isCurrent (owner nav aria-current)", () => {
  it("marks Home only on / itself", () => {
    expect(currentTabs("/")).toEqual(["/"]);
    for (const path of ["/fatture", "/anagrafiche/fornitori", "/login"])
      expect(isCurrent(path, "/")).toBe(false);
  });

  it.each(["/fatture", "/fatture/", "/fatture/x"])("marks Fatture on %s", (path) => {
    expect(currentTabs(path)).toEqual(["/fatture"]);
  });

  it.each(["/avvisi", "/avvisi/", "/avvisi/x"])("marks Avvisi on %s and no other tab", (path) => {
    expect(currentTabs(path)).toEqual(["/avvisi"]);
  });

  it.each([
    "/produzione",
    "/produzione/nuova",
    "/produzione/x/etichetta",
    "/produzione/x",
    "/produzione/personale",
  ])("marks Produzione on %s and no other tab", (path) => {
    expect(currentTabs(path)).toEqual(["/produzione"]);
  });

  it.each(["/riordino", "/riordino/", "/riordino/fornitori", "/riordino/ingredienti"])(
    "marks Riordino on %s and no other tab",
    (path) => {
      expect(currentTabs(path)).toEqual(["/riordino"]);
    },
  );

  it("does not mark Riordino on a longer sibling segment", () => {
    expect(isCurrent("/riordino-vecchio", "/riordino")).toBe(false);
  });

  it("does not match a longer sibling segment", () => {
    expect(isCurrent("/fatture-vecchie", "/fatture")).toBe(false);
  });

  it("keeps /anagrafiche/importa and /anagrafiche/ingredienti apart", () => {
    expect(currentTabs("/anagrafiche/importa")).toEqual(["/anagrafiche/importa"]);
    expect(currentTabs("/anagrafiche/ingredienti")).toEqual(["/anagrafiche/ingredienti"]);
  });

  it("marks Fornitori on a supplier detail page", () => {
    expect(currentTabs("/anagrafiche/fornitori/3f2b6c1e-0000-4000-8000-000000000001")).toEqual([
      "/anagrafiche/fornitori",
    ]);
  });

  it("marks nothing on a screen without a tab", () => {
    expect(currentTabs("/anagrafiche")).toEqual([]);
  });

  it.each(["/ricette", "/ricette/", "/ricette/nuova", "/ricette/k/versioni/2"])(
    "marks Ricette on %s and no other tab",
    (path) => {
      expect(currentTabs(path)).toEqual(["/ricette"]);
    },
  );

  it.each(["/pagamenti", "/pagamenti/", "/pagamenti/x"])(
    "marks Pagamenti on %s and no other tab",
    (path) => {
      expect(currentTabs(path)).toEqual(["/pagamenti"]);
    },
  );

  it("does not mark Pagamenti on the supplier statement", () => {
    expect(currentTabs("/anagrafiche/fornitori/x/estratto-conto")).toEqual([
      "/anagrafiche/fornitori",
    ]);
  });

  it("marks Costi on /costi and below, and never Margini or Ricette", () => {
    for (const path of ["/costi", "/costi/", "/costi/ingredienti", "/costi/ricette/abc"]) {
      expect(currentTabs(path)).toEqual(["/costi"]);
    }
  });

  it("marks Margini on /margini and no other tab", () => {
    expect(currentTabs("/margini")).toEqual(["/margini"]);
  });

  it.each(["/magazzino", "/magazzino/", "/magazzino/x", "/magazzino/sprechi"])(
    "marks Magazzino on %s",
    (path) => {
      expect(currentTabs(path)).toEqual(["/magazzino"]);
    },
  );

  it("does not mark Magazzino for a path that merely starts with the same letters", () => {
    expect(isCurrent("/magazzino-vecchio", "/magazzino")).toBe(false);
  });

  it("marks Tavoli on a table's order screen, a session id included", () => {
    expect(currentTabs("/tavoli/5e000000-0000-4000-8000-000000000001")).toEqual(["/tavoli"]);
  });

  it.each(["/tavoli", "/tavoli/", "/tavoli/impostazioni"])(
    "marks Tavoli on %s and no other tab",
    (path) => {
      expect(currentTabs(path)).toEqual(["/tavoli"]);
    },
  );

  it.each(["/menu", "/menu/", "/menu/x"])("marks Menu on %s and does not mark /margini", (path) => {
    expect(currentTabs(path)).toEqual(["/menu"]);
    expect(isCurrent(path, "/margini")).toBe(false);
  });
});
