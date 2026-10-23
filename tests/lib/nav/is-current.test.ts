import { describe, expect, it } from "vitest";
import { isCurrent } from "@/lib/nav/is-current";

// The owner nav's tabs (src/app/(owner)/owner-nav.tsx): exactly one is current on each screen.
const TABS = [
  "/",
  "/fatture",
  "/avvisi",
  "/ricette",
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
});
