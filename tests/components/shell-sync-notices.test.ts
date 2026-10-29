// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ShellSyncNotices } from "@/components/sync/shell-sync-notices";
import { EMPTY_VIEW, type SyncView } from "@/lib/sync/view";

afterEach(cleanup);
const view = (extra: Partial<SyncView>): SyncView => ({ ...EMPTY_VIEW, ready: true, ...extra });
const text = (v: SyncView, notice: string) => {
  const { container } = render(createElement(ShellSyncNotices, { view: v }));
  return container.querySelector(`[data-notice="${notice}"]`)?.textContent ?? null;
};

describe("ShellSyncNotices", () => {
  it("signed out with operations waiting: 'Accedi di nuovo per inviare 3 operazioni.'", () => {
    expect(text(view({ state: "signedOut", pending: 3 }), "signed-out")).toBe(
      "Accedi di nuovo per inviare 3 operazioni.",
    );
  });

  it("signed out with nothing waiting says nothing", () => {
    expect(text(view({ state: "signedOut", pending: 0 }), "signed-out")).toBeNull();
  });

  it("a stuck operation: 'avvisa il titolare'", () => {
    expect(text(view({ stuck: true, pending: 1 }), "stuck")).toBe(
      "Un'operazione non riesce a partire: avvisa il titolare.",
    );
  });

  it("a clock four minutes ahead", () => {
    expect(text(view({ skewMs: 240_000 }), "skew")).toBe(
      "L'ora del telefono è avanti di 4 minuti: correggila nelle impostazioni",
    );
  });

  it("a clock within a minute says nothing", () => {
    expect(text(view({ skewMs: 30_000 }), "skew")).toBeNull();
  });

  it("a browser that cannot keep the queue says so", () => {
    expect(text(view({ memoryOnly: true }), "memory-only")).toBe(
      "Questo browser non può salvare le comande senza connessione: se chiudi la pagina offline le perdi.",
    );
  });

  it("nothing wrong, nothing shown", () => {
    const { container } = render(createElement(ShellSyncNotices, { view: view({ pending: 2 }) }));
    expect(container.innerHTML).toBe("");
  });

  it("the alerts are alerts and the clock note a status", () => {
    const { container } = render(
      createElement(ShellSyncNotices, {
        view: view({ stuck: true, skewMs: 240_000, memoryOnly: true }),
      }),
    );
    expect(container.querySelector('[data-notice="stuck"]')!.getAttribute("role")).toBe("alert");
    expect(container.querySelector('[data-notice="memory-only"]')!.getAttribute("role")).toBe(
      "alert",
    );
    expect(container.querySelector('[data-notice="skew"]')!.getAttribute("role")).toBe("status");
  });
});
