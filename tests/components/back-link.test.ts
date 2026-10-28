// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BackLink } from "@/components/back-link";
import { linkClass } from "@/components/ui";

afterEach(cleanup);

describe("BackLink", () => {
  it("is a link to the parent, named by its label only", () => {
    render(createElement(BackLink, { href: "/fatture" }, "Tutte le fatture"));
    const link = screen.getByRole("link", { name: "Tutte le fatture" });
    expect(link.getAttribute("href")).toBe("/fatture");
  });

  it("draws the chevron aria-hidden, so a screen reader reads the label alone", () => {
    const { container } = render(createElement(BackLink, { href: "/x" }, "Indietro"));
    const chevron = container.querySelector("a > span")!;
    expect(chevron.textContent).toBe("‹");
    expect(chevron.getAttribute("aria-hidden")).toBe("true");
  });

  it("uses the shared link style, a 44 px target, and does not stretch across the column", () => {
    render(createElement(BackLink, { href: "/x" }, "Indietro"));
    const className = screen.getByRole("link").className;
    for (const part of linkClass.split(" ")) expect(className).toContain(part);
    expect(className).toContain("self-start");
  });
});
