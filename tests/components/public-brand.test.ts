// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let pathname = "/login";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

import { PublicBrand } from "@/app/(public)/public-brand";

afterEach(cleanup);

describe("PublicBrand", () => {
  it.each(["/prenota/osteria-demo", "/prenota/osteria-demo/annulla"])(
    "%s: the wordmark is plain text, no link",
    (path) => {
      pathname = path;
      render(createElement(PublicBrand));
      expect(screen.getByText("Osteria Dei Rossi")).toBeTruthy();
      expect(screen.queryAllByRole("link")).toHaveLength(0);
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
  ])("%s: the Costì wordmark linking to /login, no venue name", (path) => {
    pathname = path;
    const { container } = render(createElement(PublicBrand));
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Costì" }).getAttribute("href")).toBe("/login");
    expect(links[0]?.textContent).toBe("Costì");
    expect(container.textContent).not.toContain("Osteria Dei Rossi");
    expect(container.querySelector('[data-slot="brand-mark"]')).toBeNull();
  });
});
