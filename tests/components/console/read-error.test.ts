// @vitest-environment jsdom
import { StrictMode, createElement } from "react";
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

  it("stays empty when the retry fails with a different message", () => {
    const { rerender } = render(view(false, "La console non risponde. Riprova tra poco."));
    rerender(view(true, "La console non risponde. Riprova tra poco."));
    rerender(view(false, "Questo account non ha accesso alla console."));
    expect(region().textContent).toBe("");
  });

  it("announces a third failure with the message of the second, after a different second one", () => {
    const first = "La console non risponde. Riprova tra poco.";
    const second = "Questo account non ha accesso alla console.";
    const { rerender } = render(view(false, first));
    rerender(view(true, first));
    rerender(view(false, second));
    expect(region().textContent).toBe("");
    rerender(view(true, second));
    rerender(view(false, second));
    expect(region().textContent).toBe("Ancora nessuna risposta");
  });

  it("behaves the same inside StrictMode", () => {
    const wrap = (busy: boolean, message?: string) =>
      createElement(StrictMode, null, view(busy, message));
    const { rerender } = render(wrap(false));
    expect(region().textContent).toBe("");
    rerender(wrap(true));
    expect(region().textContent).toBe("");
    rerender(wrap(false));
    expect(region().textContent).toBe("Ancora nessuna risposta");
    rerender(wrap(true));
    rerender(wrap(false, "Altro errore."));
    expect(region().textContent).toBe("");
  });
});
