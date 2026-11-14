// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let pathname = "/prenota/osteria-demo";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

import PublicLayout from "@/app/(public)/layout";

afterEach(cleanup);

describe("the public layout", () => {
  it("has one band and one main, the band before the main", () => {
    const { container } = render(
      createElement(PublicLayout, null, createElement("h1", null, "Pagina")),
    );
    expect(container.querySelectorAll("header")).toHaveLength(1);
    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(screen.getByRole("banner").compareDocumentPosition(screen.getByRole("main"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("on the booking page the band has no link", () => {
    render(createElement(PublicLayout, null, createElement("h1", null, "Pagina")));
    expect(screen.getByRole("banner").querySelector("a")).toBeNull();
  });

  it("on the sign-in the band is Costì and links to /login, not to Home", () => {
    pathname = "/login";
    render(createElement(PublicLayout, null, createElement("h1", null, "Pagina")));
    const band = screen.getByRole("banner");
    expect(band.querySelector('a[href="/login"]')?.textContent).toBe("Costì");
    expect(band.querySelector('a[href="/"]')).toBeNull();
    expect(band.textContent).not.toContain("Osteria Dei Rossi");
  });
});
