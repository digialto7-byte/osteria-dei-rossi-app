// @vitest-environment jsdom
import { createElement, createRef } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SlotPicker } from "@/app/(public)/prenota/[slug]/slot-picker";
import type { SlotsReply } from "@/server/reservations/public/output";

afterEach(cleanup);

// P2i-3: the guest's service tabs are the house SegmentedControl (manual activation); the times stay buttons in the panel the tab controls.
const SERVICES: SlotsReply["services"] = [
  {
    key: "cena",
    name: "Cena",
    slots: [
      { time: "19:00", available: false },
      { time: "19:30", available: true },
    ],
  },
  { key: "pranzo", name: "Pranzo", slots: [{ time: "12:30", available: true }] },
];

function show(props: Partial<Parameters<typeof SlotPicker>[0]> = {}) {
  const onTab = vi.fn();
  const onPick = vi.fn();
  render(
    createElement(SlotPicker, {
      services: SERVICES,
      activeKey: "cena",
      chosen: null,
      locale: "it",
      onTab,
      onPick,
      ...props,
    }),
  );
  return { onTab, onPick };
}

describe("SlotPicker", () => {
  it("is a tablist named Servizio with one tab per service, the open one selected", () => {
    show();
    const list = screen.getByRole("tablist", { name: "Servizio" });
    const tabs = within(list).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Cena", "Pranzo"]);
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false"]);
  });

  it("every tab's aria-controls is a real tabpanel, labelled by the open tab, holding the times", () => {
    show();
    const panel = screen.getByRole("tabpanel");
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab.getAttribute("aria-controls")).toBe(panel.id);
    }
    expect(panel.id).not.toBe("");
    expect(panel.getAttribute("aria-labelledby")).toBe(
      screen.getByRole("tab", { name: "Cena" }).id,
    );
    expect(within(panel).getAllByRole("button").length).toBe(2);
  });

  it("tapping a tab asks for that service", () => {
    const { onTab } = show();
    fireEvent.click(screen.getByRole("tab", { name: "Pranzo" }));
    expect(onTab).toHaveBeenCalledWith("pranzo");
  });

  it("an arrow moves focus without selecting (manual activation)", () => {
    const { onTab } = show();
    screen.getByRole("tab", { name: "Cena" }).focus();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Cena" }), { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Pranzo" }));
    expect(onTab).not.toHaveBeenCalled();
  });

  it("a time is a toggle button; the chosen one is pressed", () => {
    const { onPick } = show({ chosen: { serviceKey: "cena", time: "19:30" } });
    expect(screen.getByRole("button", { name: "19:30" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "19:30" }));
    expect(onPick).toHaveBeenCalledWith({ serviceKey: "cena", time: "19:30" });
  });

  it("a taken time is disabled and named as unavailable", () => {
    show();
    const taken = screen.getByRole("button", { name: "19:00, non disponibile" });
    expect((taken as HTMLButtonElement).disabled).toBe(true);
  });

  it("firstFreeRef is the first free time", () => {
    const ref = createRef<HTMLButtonElement>();
    show({ firstFreeRef: ref });
    expect(ref.current).toBe(screen.getByRole("button", { name: "19:30" }));
  });

  it("firstFreeRef is the open tab when only another service has a free time", () => {
    const ref = createRef<HTMLButtonElement>();
    show({
      firstFreeRef: ref,
      services: [{ ...SERVICES[0]!, slots: [{ time: "19:00", available: false }] }, SERVICES[1]!],
    });
    expect(ref.current).toBe(screen.getByRole("tab", { name: "Cena" }));
  });
});
