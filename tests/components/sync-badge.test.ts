// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncBadge } from "@/components/sync/sync-badge";
import { EMPTY_VIEW, type SyncView } from "@/lib/sync/view";

afterEach(cleanup);
const view = (extra: Partial<SyncView>): SyncView => ({
  ...EMPTY_VIEW,
  ready: true,
  visible: true,
  ...extra,
});
const show = (v: SyncView, now = 0, expanded = false, onToggle = () => undefined) =>
  render(createElement(SyncBadge, { view: v, now, expanded, onToggle }));

describe("SyncBadge", () => {
  it("shows 'In coda · 3' as a 44 px button with the accessible name '3 operazioni in attesa di invio'", () => {
    show(view({ pending: 3 }));
    const button = screen.getByRole("button", { name: "3 operazioni in attesa di invio" });
    expect(button.textContent).toBe("In coda · 3");
    expect(button.className).toContain("min-h-tap");
  });

  it("the state word is in a polite live region: Offline, then Invio…, then the countdown", () => {
    const { container, rerender } = show(view({ pending: 3, state: "offline" }));
    const status = container.querySelector('[role="status"]')!;
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("Offline");
    rerender(
      createElement(SyncBadge, {
        view: view({ pending: 3, state: "sending" }),
        now: 0,
        expanded: false,
        onToggle: () => undefined,
      }),
    );
    expect(container.querySelector('[role="status"]')!.textContent).toBe("Invio…");
    rerender(
      createElement(SyncBadge, {
        view: view({ pending: 3, state: "backoff", nextAttemptAt: 15_000 }),
        now: 0,
        expanded: false,
        onToggle: () => undefined,
      }),
    );
    expect(container.querySelector('[role="status"]')!.textContent).toBe(
      "Nuovo tentativo tra 15 s",
    );
  });

  it("is hidden at 0: nothing waiting, held or unseen", () => {
    const { container } = show(EMPTY_VIEW);
    expect(container.innerHTML).toBe("");
    const hidden = show(view({ visible: false, pending: 0 }));
    expect(hidden.container.querySelector('[data-slot="sync-badge"]')).toBeNull();
  });

  it("with only unseen notices it reads 'Avvisi · 2'", () => {
    show(view({ pending: 0, unseen: 2 }));
    expect(screen.getByRole("button", { name: "2 avvisi da leggere" }).textContent).toBe(
      "Avvisi · 2",
    );
  });

  it("a tap toggles the panel and aria-expanded follows", () => {
    const onToggle = vi.fn();
    show(view({ pending: 1 }), 0, true, onToggle);
    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("no text contains a euro sign, 'Costo' or 'Margine'", () => {
    const { container } = show(view({ pending: 3, state: "offline" }));
    expect(container.textContent).not.toMatch(/€|Costo|Margine|Food cost/);
  });
});
