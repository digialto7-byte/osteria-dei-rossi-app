// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { navigateTo, needsFullLoad } from "@/lib/nav/full-load";

// P2-1 T-12: the CSP follows the fully loaded document, so a way into a QR page must be a document load.

const original = Object.getOwnPropertyDescriptor(window, "location")!;
afterEach(() => Object.defineProperty(window, "location", original));

describe("needsFullLoad", () => {
  it.each([
    "/login/attiva-codice",
    "/login/attiva-codice?next=%2Foggi",
    "/login/offerta-codice?next=%2F",
    "/doppia-verifica",
    "/doppia-verifica#fattori",
    "/doppia-verifica/",
    "/login/attiva-codice/?next=%2F",
  ])("%s is a QR page", (href) => {
    expect(needsFullLoad(href)).toBe(true);
  });

  it.each([
    "/",
    "/oggi",
    "/login",
    "/login/codice",
    "/doppia-verifica-x",
    "/doppia-verifica/x",
    "",
  ])("%s is not", (href) => {
    expect(needsFullLoad(href)).toBe(false);
  });
});

describe("navigateTo", () => {
  const setup = () => {
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { assign }, configurable: true });
    return { assign, router: { replace: vi.fn() } };
  };

  it("loads a QR page as a new document and does not touch the router", () => {
    const { assign, router } = setup();
    navigateTo(router, "/login/attiva-codice?next=%2Foggi");
    expect(assign).toHaveBeenCalledWith("/login/attiva-codice?next=%2Foggi");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("uses the router for any other page", () => {
    const { assign, router } = setup();
    navigateTo(router, "/oggi");
    expect(router.replace).toHaveBeenCalledWith("/oggi");
    expect(assign).not.toHaveBeenCalled();
  });
});
