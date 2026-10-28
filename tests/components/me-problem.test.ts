// @vitest-environment jsdom
import { createElement } from "react";
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
