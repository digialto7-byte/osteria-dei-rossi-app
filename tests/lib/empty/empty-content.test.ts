import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { t } from "@/lib/i18n";
import { emptyFor, RECIPE_WRITER_ROLES, type EmptyScreen } from "@/lib/empty/empty-content";

const SCREENS: EmptyScreen[] = [
  "suppliers",
  "ingredients",
  "stock",
  "costs",
  "margins",
  "recipes",
  "tables",
  "devices",
  "criticalCounts",
  "batchRecipes",
];
const ROLES = ["owner", "admin", "chef", "waiter", null] as const;
const action = (screen: EmptyScreen, role: string | null) => {
  const content = emptyFor(screen, role);
  return content.action ? { label: t(content.action.labelKey), href: content.action.href } : null;
};

describe("emptyFor: the next step of an empty screen", () => {
  it.each(["suppliers", "ingredients"] as const)(
    "%s: owner and admin can import from a file, the chef reads text only",
    (screen) => {
      for (const role of ["owner", "admin"]) {
        expect(action(screen, role)).toEqual({
          label: "Importa da file",
          href: "/anagrafiche/importa",
        });
      }
      for (const role of ["chef", "waiter", null]) expect(action(screen, role)).toBeNull();
    },
  );

  it("stock: owner and admin go to the invoices; the chef is told the owner approves them, with no link", () => {
    for (const role of ["owner", "admin"]) {
      expect(action("stock", role)).toEqual({ label: "Vai alle fatture", href: "/fatture" });
    }
    expect(action("stock", "chef")).toBeNull();
    expect(t(emptyFor("stock", "chef").messageKey)).toMatch(/titolare.*fatture/);
    expect(t(emptyFor("stock", "owner").messageKey)).toMatch(/approvazione delle fatture/);
  });

  it("costs: owner and admin create a recipe; margins: the chef does", () => {
    for (const role of ["owner", "admin"]) {
      expect(action("costs", role)).toEqual({ label: "Crea una ricetta", href: "/ricette/nuova" });
    }
    expect(action("margins", "chef")).toEqual({
      label: "Crea una ricetta",
      href: "/ricette/nuova",
    });
    expect(action("costs", "chef")).toBeNull();
  });

  it("recipes: owner and admin can import; the chef already has Nuova ricetta on the page", () => {
    expect(action("recipes", "owner")).toEqual({
      label: "Importa da file",
      href: "/anagrafiche/importa",
    });
    expect(action("recipes", "chef")).toBeNull();
  });

  it("tables: owner and admin go to the settings; the waiter reads text only", () => {
    for (const role of ["owner", "admin"]) {
      expect(action("tables", role)).toEqual({
        label: "Aggiungi i tavoli",
        href: "/tavoli/impostazioni",
      });
    }
    expect(action("tables", "waiter")).toBeNull();
    expect(t(emptyFor("tables", "waiter").messageKey)).toContain("titolare");
  });

  it("devices: staff first; critical counts: like the stock", () => {
    expect(action("devices", "owner")).toEqual({
      label: "Aggiungi il personale",
      href: "/personale",
    });
    expect(action("criticalCounts", "admin")).toEqual({
      label: "Vai alle fatture",
      href: "/fatture",
    });
    expect(action("criticalCounts", "chef")).toBeNull();
  });

  // QW8 (docs/plans/2026-11-13-ux-quick-wins.md): /produzione/nuova with no batch recipe offers "Crea una ricetta" to the roles that
  // POST /api/recipes allows, and text only to the others.
  it("batchRecipes: owner, admin and chef are offered Crea una ricetta; the waiter and an unknown role get text only", () => {
    for (const role of ["owner", "admin", "chef"]) {
      expect(action("batchRecipes", role), role).toEqual({
        label: "Crea una ricetta",
        href: "/ricette/nuova",
      });
    }
    for (const role of ["waiter", null, "guest"])
      expect(action("batchRecipes", role), String(role)).toBeNull();
    expect(t(emptyFor("batchRecipes", "owner").messageKey)).toBe(
      "Nessuna ricetta di produzione attiva.",
    );
  });

  it("the mirrored role list equals the roles of POST /api/recipes, read from the route", () => {
    const route = readFileSync(
      new URL("../../../src/app/api/recipes/route.ts", import.meta.url),
      "utf8",
    );
    const readers = /const READERS = \[([^\]]*)\] as const;/.exec(route);
    expect(readers).not.toBeNull();
    const fromRoute = [...readers![1]!.matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
    expect([...RECIPE_WRITER_ROLES]).toEqual(fromRoute);
    // POST takes exactly that list.
    expect(route).toMatch(/export const POST = withApi\(\s*\{ roles: READERS,/);
  });

  it("no role is ever offered a link to a page its nav does not show it", () => {
    const allowed: Record<string, string[]> = {
      chef: ["/ricette/nuova"],
      waiter: [],
    };
    for (const screen of SCREENS) {
      for (const role of ["chef", "waiter"] as const) {
        const a = action(screen, role);
        if (a) expect(allowed[role], `${screen}/${role}`).toContain(a.href);
      }
    }
  });

  it("every message and label exists in Italian and English, with no euro sign", () => {
    for (const screen of SCREENS) {
      for (const role of ROLES) {
        const content = emptyFor(screen, role);
        for (const locale of ["it", "en"] as const) {
          const texts = [t(content.messageKey, {}, locale)];
          if (content.action) texts.push(t(content.action.labelKey, {}, locale));
          for (const text of texts) expect(text, `${screen}/${role}/${locale}`).not.toMatch(/€|\{/);
        }
      }
    }
  });
});
