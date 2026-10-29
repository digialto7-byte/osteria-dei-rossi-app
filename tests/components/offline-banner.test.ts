// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OfflineBanner } from "@/components/sync/offline-banner";

afterEach(cleanup);

describe("OfflineBanner", () => {
  it("says orders stay on the phone and the kitchen does not see them yet", () => {
    render(createElement(OfflineBanner, { cachedAt: null }));
    expect(screen.getByRole("status").textContent).toBe(
      "Sei offline. Le comande restano sul telefono e partono appena torna la connessione. La cucina non le vede ancora.",
    );
  });

  it("adds 'Dati delle 20:31' in venue time from the worker's instant", () => {
    render(createElement(OfflineBanner, { cachedAt: "2026-11-02T19:31:00.000Z" }));
    expect(screen.getByRole("status").textContent).toContain("Dati delle 20:31");
  });

  it("ignores an instant it cannot read", () => {
    render(createElement(OfflineBanner, { cachedAt: "yesterday" }));
    expect(screen.getByRole("status").textContent).not.toContain("Dati delle");
  });
});
