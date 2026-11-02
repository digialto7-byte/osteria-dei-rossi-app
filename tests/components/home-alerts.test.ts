// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeAlertsView } from "@/components/home/home-alerts";
import type { AlertItem } from "@/server/alerts/list";

afterEach(cleanup);

// M25b step 13 (plan §3.1.7): the Home strip of open alerts. Pure view: the page owns the reads. Fixture values are fake.
const alert = (n: number, over: Partial<AlertItem> = {}): AlertItem => ({
  id: `a1000000-0000-4000-8000-00000000000${n}`,
  kind: "test_alert",
  severity: "info",
  entityType: "tenant",
  entityId: null,
  businessDate: "2026-10-25",
  createdAt: "2026-10-25T00:30:00.000Z",
  title: `Avviso ${n}`,
  body: `Corpo ${n}`,
  href: null,
  acknowledged: null,
  ...over,
});
const BADGE = { labelKey: "today.badge.alerts", count: 4, tone: "warning" } as const;

function show(props: Partial<Parameters<typeof HomeAlertsView>[0]> = {}) {
  const onAcknowledge = vi.fn();
  const view = render(
    createElement(HomeAlertsView, {
      status: "ok",
      alerts: [alert(1), alert(2), alert(3)],
      badge: BADGE,
      busyId: null,
      error: null,
      onAcknowledge,
      ...props,
    }),
  );
  return { ...view, onAcknowledge };
}

describe("HomeAlertsView", () => {
  it("is a section headed Avvisi, with the badge and three alert rows", () => {
    const { container } = show();
    const section = container.querySelector("section")!;
    expect(within(section).getByRole("heading", { level: 2, name: "Avvisi" })).toBeTruthy();
    expect(within(section).getByText("Avvisi da vedere · 4")).toBeTruthy();
    expect(section.querySelectorAll("li")).toHaveLength(3);
    expect(within(section).getAllByRole("button", { name: "Ho visto" })).toHaveLength(3);
  });

  it("links to the full list with Tutti gli avvisi", () => {
    show();
    expect(screen.getByRole("link", { name: "Tutti gli avvisi" }).getAttribute("href")).toBe(
      "/avvisi",
    );
  });

  it("says Nessun avviso da vedere when empty, and still links to the list", () => {
    show({ alerts: [] });
    expect(screen.getByText("Nessun avviso da vedere.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ho visto" })).toBeNull();
    expect(screen.getByRole("link", { name: "Tutti gli avvisi" })).toBeTruthy();
  });

  it("reports the id of the alert whose Ho visto was pressed", () => {
    const { onAcknowledge } = show();
    fireEvent.click(screen.getAllByRole("button", { name: "Ho visto" })[1]!);
    expect(onAcknowledge).toHaveBeenCalledWith(alert(2).id);
  });

  it("disables only the busy row's button", () => {
    show({ busyId: alert(1).id });
    const buttons = screen.getAllByRole("button", { name: "Ho visto" }) as HTMLButtonElement[];
    expect(buttons.map((b) => b.disabled)).toEqual([true, false, false]);
  });

  it("shows one alert with the message in the strip on an error, and the link stays", () => {
    show({ status: "error", alerts: [], error: "Gli avvisi non sono disponibili." });
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert").textContent).toBe("Gli avvisi non sono disponibili.");
    expect(screen.queryByText("Nessun avviso da vedere.")).toBeNull();
    expect(screen.getByRole("link", { name: "Tutti gli avvisi" })).toBeTruthy();
  });

  it("shows a loading note and no empty text while loading", () => {
    show({ status: "loading", alerts: [], badge: null });
    expect(screen.getByText("Caricamento…")).toBeTruthy();
    expect(screen.queryByText("Nessun avviso da vedere.")).toBeNull();
  });

  it("works without a badge", () => {
    show({ badge: null });
    expect(screen.queryByText(/Avvisi da vedere/)).toBeNull();
  });

  it("shows no euro sign", () => {
    const { container } = show();
    expect(container.textContent).not.toContain("€");
  });
});
