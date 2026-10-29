// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShellView } from "@/app/(owner)/app-shell";
import type { MeState } from "@/components/use-me";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

afterEach(cleanup);

const ID = "5b0c9f0e-1c1d-4b5e-9d5a-0a1b2c3d4e5f";

const ok = (role: "owner" | "admin" | "chef" | "waiter"): MeState => ({
  status: "ok",
  me: {
    user: { id: "a0000000-0000-4000-8000-000000000001", displayName: "Utente Demo", role },
    tenant: { id: "b0000000-0000-4000-8000-000000000001", name: "Osteria Demo" },
  },
});
const LOADING: MeState = { status: "loading", me: null };

function shell(state: MeState, pathname: string) {
  const view = render(
    createElement(AppShellView, { state, pathname }, createElement("h1", null, "Pagina")),
  );
  const slot = (name: string) => view.container.querySelector(`[data-slot="${name}"]`);
  const links = (name: string) =>
    [...(slot(name)?.querySelectorAll("a") ?? [])].map((a) => ({
      text: a.textContent?.trim() ?? "",
      href: a.getAttribute("href"),
      current: a.getAttribute("aria-current"),
    }));
  return { ...view, slot, links };
}

describe("AppShellView, the bottom tab bar (phone)", () => {
  it("shows one tab per group of the owner, each to the group's landing page", () => {
    const { links } = shell(ok("owner"), "/fatture");
    expect(links("bottom-tabs").map((l) => [l.text, l.href])).toEqual([
      ["Oggi", "/"],
      ["Acquisti", "/fatture"],
      ["Cucina", "/cucina"],
      ["Sala", "/tavoli"],
      ["Gestione", "/costi"],
    ]);
  });

  it("is a nav named Sezioni and marks only the current group", () => {
    const { slot, links } = shell(ok("owner"), "/pagamenti");
    expect(slot("bottom-tabs")?.getAttribute("aria-label")).toBe("Sezioni");
    expect(
      links("bottom-tabs")
        .filter((l) => l.current === "page")
        .map((l) => l.text),
    ).toEqual(["Acquisti"]);
  });

  it("marks Gestione on /dispositivi", () => {
    const { links } = shell(ok("owner"), "/dispositivi");
    expect(
      links("bottom-tabs")
        .filter((l) => l.current)
        .map((l) => l.text),
    ).toEqual(["Gestione"]);
  });

  it("gives every tab a 44 px target", () => {
    const { slot } = shell(ok("owner"), "/");
    for (const a of slot("bottom-tabs")!.querySelectorAll("a")) {
      expect(a.className).toContain("min-h-tap");
    }
  });

  it("gives the chef three tabs and the admin five", () => {
    expect(
      shell(ok("chef"), "/")
        .links("bottom-tabs")
        .map((l) => l.text),
    ).toEqual(["Oggi", "Cucina", "Gestione"]);
    cleanup();
    expect(shell(ok("admin"), "/").links("bottom-tabs")).toHaveLength(5);
  });

  it("is padded for the phone's safe area and the keyboard rule can find it", () => {
    const { slot } = shell(ok("owner"), "/");
    expect(slot("bottom-tabs")!.className).toContain("env(safe-area-inset-bottom)");
    expect(slot("bottom-tabs")!.className).toContain("lg:hidden");
  });

  it("is not shown to the waiter, who has a single group", () => {
    const { slot } = shell(ok("waiter"), "/tavoli");
    expect(slot("bottom-tabs")).toBeNull();
    expect(slot("section-nav")).toBeNull();
  });

  it("marks no tab on a page outside the role's navigation", () => {
    const { links, slot } = shell(ok("chef"), "/pagamenti");
    expect(slot("bottom-tabs")).not.toBeNull();
    expect(links("bottom-tabs").some((l) => l.current)).toBe(false);
    expect(slot("section-nav")).toBeNull();
  });
});

describe("AppShellView, the section row (phone)", () => {
  it("lists the current group's sections only, named Menu principale", () => {
    const { slot, links } = shell(ok("owner"), "/fatture");
    expect(slot("section-nav")?.getAttribute("aria-label")).toBe("Menu principale");
    expect(links("section-nav").map((l) => [l.text, l.href])).toEqual([
      ["Fatture", "/fatture"],
      ["Pagamenti", "/pagamenti"],
      ["Fornitori", "/anagrafiche/fornitori"],
    ]);
  });

  it("marks the current section, also on a page below it", () => {
    const { links } = shell(ok("owner"), "/pagamenti/abc");
    expect(
      links("section-nav")
        .filter((l) => l.current)
        .map((l) => l.text),
    ).toEqual(["Pagamenti"]);
  });

  it("marks Personale on /dispositivi", () => {
    const { links } = shell(ok("owner"), "/dispositivi");
    expect(
      links("section-nav")
        .filter((l) => l.current)
        .map((l) => l.text),
    ).toEqual(["Personale"]);
  });

  it("holds at most 6 pills, each 44 px tall", () => {
    const { slot, links } = shell(ok("owner"), "/costi");
    expect(links("section-nav").length).toBeLessThanOrEqual(6);
    for (const a of slot("section-nav")!.querySelectorAll("a")) {
      expect(a.className).toContain("min-h-tap");
    }
  });

  it("is left out when the group has a single section", () => {
    expect(shell(ok("admin"), "/").slot("section-nav")).toBeNull();
  });

  it("is hidden at laptop width, where the sidebar takes over", () => {
    expect(shell(ok("owner"), "/fatture").slot("section-nav")!.className).toContain("lg:hidden");
  });
});

describe("AppShellView, the sidebar (laptop)", () => {
  it("is hidden below 1024 px and named Menu principale", () => {
    const { slot } = shell(ok("owner"), "/");
    expect(slot("sidebar-nav")!.className).toContain("hidden");
    expect(slot("sidebar-nav")!.className).toContain("lg:flex");
    expect(slot("sidebar-nav")!.getAttribute("aria-label")).toBe("Menu principale");
  });

  it("shows a heading per group and every section of the owner", () => {
    const { slot, links } = shell(ok("owner"), "/");
    const headings = [...slot("sidebar-nav")!.querySelectorAll("h2")].map((h) => h.textContent);
    expect(headings).toEqual(["Oggi", "Acquisti", "Cucina", "Sala", "Gestione"]);
    expect(links("sidebar-nav")).toHaveLength(2 + 3 + 5 + 2 + 6);
  });

  it("marks the current section and the user's name and role in the footer", () => {
    const { slot, links } = shell(ok("chef"), "/magazzino");
    expect(
      links("sidebar-nav")
        .filter((l) => l.current)
        .map((l) => l.text),
    ).toEqual(["Magazzino"]);
    expect(slot("sidebar-nav")!.textContent).toContain("Utente Demo");
    expect(slot("sidebar-nav")!.textContent).toContain("Cucina");
  });

  it("has Esci in the footer, for every role (the waiter has no other way out on a laptop)", () => {
    for (const role of ["owner", "chef", "waiter"] as const) {
      const { slot } = shell(ok(role), "/");
      const buttons = [...slot("sidebar-nav")!.querySelectorAll("button")];
      expect(buttons.map((b) => b.textContent)).toEqual(["Esci"]);
      cleanup();
    }
  });

  it("shows the waiter Sala > Tavoli and nothing else", () => {
    const { links } = shell(ok("waiter"), "/tavoli");
    expect(links("sidebar-nav").map((l) => l.href)).toEqual(["/tavoli"]);
  });

  it("is shown on a focus route too (only the phone bars go)", () => {
    expect(shell(ok("owner"), `/tavoli/${ID}`).slot("sidebar-nav")).not.toBeNull();
  });
});

describe("AppShellView, focus routes", () => {
  it.each([`/tavoli/${ID}`, `/magazzino/conteggi/${ID}`])(
    "shows neither the tab bar nor the section row on %s",
    (path) => {
      const { slot } = shell(ok("owner"), path);
      expect(slot("bottom-tabs")).toBeNull();
      expect(slot("section-nav")).toBeNull();
      expect(slot("nav-placeholder")).toBeNull();
    },
  );

  it("keeps them on the pages around the focus routes", () => {
    expect(shell(ok("owner"), "/tavoli").slot("bottom-tabs")).not.toBeNull();
    cleanup();
    expect(shell(ok("owner"), "/magazzino/conteggi").slot("bottom-tabs")).not.toBeNull();
  });

  it("keeps the tab bar and the section row on the kitchen screen /cucina (M19): the chef's way back", () => {
    const { slot, links } = shell(ok("chef"), "/cucina");
    expect(slot("bottom-tabs")).not.toBeNull();
    expect(slot("section-nav")).not.toBeNull();
    expect(links("section-nav").map((l) => l.text)).toContain("Comande");
  });
});

describe("AppShellView, while the role is not known", () => {
  it("renders fixed-height placeholders and no link at all", () => {
    const { container, slot } = shell(LOADING, "/fatture");
    expect(container.querySelectorAll("nav a")).toHaveLength(0);
    expect(container.querySelector("a")).toBeNull();
    expect(slot("nav-placeholder")).not.toBeNull();
    expect(slot("nav-placeholder")!.getAttribute("aria-hidden")).toBe("true");
  });

  it.each<MeState>([
    { status: "signedOut", me: null },
    { status: "noAccess", me: null },
    { status: "error", me: null },
  ])("shows no navigation for $status, only the page", (state) => {
    const { container, slot } = shell(state, "/");
    expect(container.querySelector("nav")).toBeNull();
    expect(slot("nav-placeholder")).toBeNull();
    expect(container.querySelector("main h1")?.textContent).toBe("Pagina");
  });
});

describe("AppShellView, the page", () => {
  it("renders the page inside exactly one main, with the demo banner slot above it", () => {
    const { container } = shell(ok("owner"), "/fatture");
    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(container.querySelector("main h1")?.textContent).toBe("Pagina");
  });

  it("keeps the last element of main clear of the tab bar", () => {
    const { container } = shell(ok("owner"), "/fatture");
    expect(container.querySelector("main")!.className).toMatch(
      /pb-\[calc\(.*safe-area-inset-bottom/,
    );
  });

  it("needs no extra padding where there is no tab bar", () => {
    for (const [state, path] of [
      [ok("waiter"), "/tavoli"],
      [ok("owner"), `/tavoli/${ID}`],
    ] as const) {
      const { container } = shell(state, path);
      expect(container.querySelector("main")!.className).not.toMatch(/pb-\[calc\(/);
      cleanup();
    }
  });
});

// UX plan C7 (P2-7): on a laptop a signed-in list page is wider than the phone column, up to max-w-3xl; a data-layout="wide"
// page (the dashboard, the invoice review, the kitchen) keeps its own wider column. The phone column is unchanged.
describe("AppShellView, the laptop column", () => {
  it("keeps the phone column and widens main to max-w-3xl from the laptop breakpoint", () => {
    const className = shell(ok("owner"), "/magazzino").container.querySelector("main")!.className;
    const classes = className.split(/\s+/);
    expect(classes).toContain("max-w-md");
    expect(classes).toContain("lg:max-w-3xl");
  });

  it("leaves a wide page its own, wider column", () => {
    const classes = shell(ok("owner"), "/fatture/x/revisione")
      .container.querySelector("main")!
      .className.split(/\s+/);
    expect(classes).toContain("lg:has-[[data-layout=wide]]:max-w-6xl");
  });

  it("applies to every role that has the shell", () => {
    for (const role of ["owner", "admin", "chef"] as const) {
      const main = shell(ok(role), "/magazzino").container.querySelector("main")!;
      expect(main.classList.contains("lg:max-w-3xl")).toBe(true);
      cleanup();
    }
  });
});

describe("AppShellView, what the chef and the waiter never see", () => {
  it.each(["chef", "waiter"] as const)("has no euro sign anywhere in the %s's shell", (role) => {
    for (const path of ["/", "/produzione", "/magazzino", "/tavoli"]) {
      const { container } = shell(ok(role), path);
      expect(container.textContent).not.toContain("€");
      cleanup();
    }
  });

  it("gives the chef no link to money pages", () => {
    const { container } = shell(ok("chef"), "/");
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    for (const forbidden of ["/fatture", "/pagamenti", "/costi", "/anagrafiche/importa"]) {
      expect(hrefs).not.toContain(forbidden);
    }
  });
});
