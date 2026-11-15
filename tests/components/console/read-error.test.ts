// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReadError } from "@/components/console/read-error";

// A repeated failed «Riprova» is announced politely; the live region stays mounted so a text change is read.

afterEach(cleanup);

function view(busy: boolean, message = "Non riesco a leggere i locali.") {
  return createElement(ReadError, { message, onRetry: vi.fn(), busy });
}
const region = () => screen.getByRole("status");

describe("ReadError: repeated failure announcement", () => {
  it("has an empty polite status from the first render, with no announcement", () => {
    render(view(false));
    expect(region().textContent).toBe("");
    expect(region().className).toContain("sr-only");
    expect(screen.queryByText("Ancora nessuna risposta")).toBeNull();
  });

  it("does not announce while the retry is in flight", () => {
    const { rerender } = render(view(false));
    rerender(view(true));
    expect(region().textContent).toBe("");
  });

  it("announces when the retry fails again, in the same region that was mounted before", () => {
    const { rerender } = render(view(false));
    const before = region();
    rerender(view(true));
    rerender(view(false));
    expect(region()).toBe(before);
    expect(region().textContent).toBe("Ancora nessuna risposta");
  });

  it("clears while the next retry runs and announces again if it fails again", () => {
    const { rerender } = render(view(false));
    rerender(view(true));
    rerender(view(false));
    rerender(view(true));
    expect(region().textContent).toBe("");
    rerender(view(false));
    expect(region().textContent).toBe("Ancora nessuna risposta");
  });

  it("goes away with the error when a retry succeeds", () => {
    const { rerender } = render(view(false));
    rerender(view(true));
    rerender(view(false));
    rerender(createElement("div"));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText("Ancora nessuna risposta")).toBeNull();
  });

  it("keeps the retry button behaviour: aria-disabled while busy and clicks ignored", () => {
    const onRetry = vi.fn();
    const { rerender } = render(createElement(ReadError, { message: "x", onRetry, busy: false }));
    fireEvent.click(screen.getByRole("button", { name: "Riprova" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    rerender(createElement(ReadError, { message: "x", onRetry, busy: true }));
    const button = screen.getByRole("button", { name: "Riprova" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
