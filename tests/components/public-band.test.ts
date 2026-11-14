// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let pathname = "/login";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

import { PublicBand } from "@/app/(public)/public-band";

afterEach(cleanup);

describe("PublicBand", () => {
  // Lead decision Q-L2 (ADR-045): the guest band wears the venue layer, the product band does not.
  it.each(["/prenota/osteria-demo", "/prenota/osteria-demo/annulla"])(
    "%s: one banner with the venue's two band properties, the name as plain text, no link",
    (path) => {
      pathname = path;
      const { container } = render(createElement(PublicBand));
      expect(screen.getAllByRole("banner")).toHaveLength(1);
      expect(container.querySelector("header")?.getAttribute("style")).toBe(
        "--color-band: #1C4130; --color-band-ink: #F7F8F6;",
      );
      expect(screen.getByText("Osteria Dei Rossi")).toBeTruthy();
      expect(screen.queryAllByRole("link")).toHaveLength(0);
      expect(container.querySelector("[data-slot=brand-mark]")).toBeNull();
    },
  );

  // Founder decision 2026-11-14: the staff sign-in surfaces are Costì only. The band shows the product's wordmark, links to /login, and its
  // accessible name is the visible text (WCAG 2.5.3), not the venue's brand.homeLink.
  it.each([
    "/login",
    "/login/codice",
    "/login/offerta-codice",
    "/login/attiva-codice",
    "/pin",
    "/dispositivo",
  ])("%s: the Costì wordmark linking to /login, no venue name, no mark and no style", (path) => {
    pathname = path;
    const { container } = render(createElement(PublicBand));
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Costì" }).getAttribute("href")).toBe("/login");
    expect(links[0]?.textContent).toBe("Costì");
    expect(container.textContent).not.toContain("Osteria Dei Rossi");
    expect(container.querySelector('[data-slot="brand-mark"]')).toBeNull();
    expect(container.querySelector("header")?.hasAttribute("style")).toBe(false);
  });
});
