// @vitest-environment jsdom
import { createElement, createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeProblem } from "@/components/me-problem";

afterEach(cleanup);

const page = (retry: () => void) =>
  render(
    createElement(
      "main",
      null,
      createElement("h1", null, "Fatture"),
      createElement(MeProblem, { status: "error", retry }),
    ),
  );

describe("MeProblem", () => {
  it("on Riprova asks again and moves focus to the page heading, so focus does not fall to the body", () => {
    const retry = vi.fn();
    page(retry);
    const button = screen.getByRole("button", { name: "Riprova" });
    button.focus();
    fireEvent.click(button);
    expect(retry).toHaveBeenCalledTimes(1);
    const heading = screen.getByRole("heading", { name: "Fatture" });
    expect(document.activeElement).toBe(heading);
    expect(heading.getAttribute("tabindex")).toBe("-1");
  });

  it("X2: a page without a heading gets focus on its main, which stays when the page goes back to loading", () => {
    const retry = vi.fn();
    render(createElement("main", null, createElement(MeProblem, { status: "error", retry })));
    fireEvent.click(screen.getByRole("button", { name: "Riprova" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByRole("main"));
  });

  it("X2: an explicit focus target wins over the heading, and is not looked up through the document", () => {
    const target = createRef<HTMLElement>();
    render(
      createElement(
        "div",
        null,
        createElement("h1", null, "Altro titolo"),
        createElement(
          "main",
          null,
          createElement("h2", { ref: target }, "Sezione"),
          createElement(MeProblem, { status: "error", retry: vi.fn(), focusRef: target }),
        ),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Riprova" }));
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Sezione" }));
  });

  it("X2: another page's heading elsewhere in the document is not stolen", () => {
    render(
      createElement(
        "div",
        null,
        createElement("h1", null, "Banner"),
        createElement("main", null, createElement(MeProblem, { status: "error", retry: vi.fn() })),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Riprova" }));
    expect(document.activeElement).not.toBe(screen.getByRole("heading", { name: "Banner" }));
  });

  it("still asks again when the page has no heading", () => {
    const retry = vi.fn();
    render(createElement(MeProblem, { status: "error", retry }));
    fireEvent.click(screen.getByRole("button", { name: "Riprova" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("signed out is the sign-in link and no retry; no access is one alert", () => {
    const { unmount } = render(createElement(MeProblem, { status: "signedOut", retry: vi.fn() }));
    expect(screen.getByRole("link", { name: "Accedi" }).getAttribute("href")).toBe("/login");
    expect(screen.queryByRole("button")).toBeNull();
    unmount();
    render(createElement(MeProblem, { status: "noAccess", retry: vi.fn() }));
    expect(screen.getByRole("alert").textContent).toContain("non è abilitato");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
