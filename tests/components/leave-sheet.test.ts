// @vitest-environment jsdom
import { createElement, useState } from "react";
import { cleanup, createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LeaveSheet } from "@/app/(owner)/tavoli/comanda/leave-sheet";

// QW12 (docs/plans/2026-11-13-ux-quick-wins.md): the sheet a waiter sees when leaving a table with dishes not sent.
afterEach(cleanup);

type Props = Parameters<typeof LeaveSheet>[0];
const show = (over: Partial<Props> = {}) => {
  const props = {
    groups: [{ course: "antipasti", ids: ["a1", "a2"] }],
    onSend: vi.fn(),
    onLeave: vi.fn(),
    onStay: vi.fn(),
    ...over,
  } as Props;
  render(createElement(LeaveSheet, props));
  return props;
};

describe("LeaveSheet", () => {
  it("is a modal dialog named by its title, with the focus on the title", () => {
    show();
    const dialog = screen.getByRole("dialog", { name: "2 piatti non inviati" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement?.textContent).toBe("2 piatti non inviati");
  });

  it("says one dish in the singular, and counts all courses in the title", () => {
    show({ groups: [{ course: "antipasti", ids: ["a1"] }] });
    expect(screen.getByRole("dialog", { name: "1 piatto non inviato" })).toBeTruthy();
    cleanup();
    show({
      groups: [
        { course: "antipasti", ids: ["a1"] },
        { course: "secondi", ids: ["s1", "s2"] },
      ],
    });
    expect(screen.getByRole("dialog", { name: "3 piatti non inviati" })).toBeTruthy();
  });

  it("has one Invia button per course with the right ids; the first course is primary, the others secondary", () => {
    const props = show({
      groups: [
        { course: "antipasti", ids: ["a1", "a2"] },
        { course: "secondi", ids: ["s1"] },
      ],
    });
    const first = screen.getByRole("button", { name: "Invia antipasti · 2" });
    const second = screen.getByRole("button", { name: "Invia secondi · 1" });
    expect(first.className).toContain("bg-accent");
    expect(second.className).not.toContain("bg-accent");
    expect(second.className).toContain("border-ink");
    fireEvent.click(first);
    expect(props.onSend).toHaveBeenLastCalledWith(["a1", "a2"]);
    fireEvent.click(second);
    expect(props.onSend).toHaveBeenLastCalledWith(["s1"]);
  });

  it("Esci comunque leaves, and is a secondary button", () => {
    const props = show();
    const button = screen.getByRole("button", { name: "Esci comunque" });
    expect(button.className).toContain("border-ink");
    fireEvent.click(button);
    expect(props.onLeave).toHaveBeenCalledTimes(1);
    expect(props.onStay).not.toHaveBeenCalled();
  });

  it("Resta al tavolo, Escape and a tap on the scrim all stay", () => {
    const props = show();
    fireEvent.click(screen.getByRole("button", { name: "Resta al tavolo" }));
    expect(props.onStay).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onStay).toHaveBeenCalledTimes(2);
    fireEvent.click(document.querySelector('[data-slot="leave-scrim"]')!);
    expect(props.onStay).toHaveBeenCalledTimes(3);
    expect(props.onLeave).not.toHaveBeenCalled();
    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("uses the bottom-sheet classes of the weight sheet, with existing tokens only", () => {
    show();
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("fixed inset-x-0 bottom-0");
    expect(dialog.className).toContain("rounded-t-2xl");
    expect(dialog.className).toContain("bg-surface");
    expect(dialog.className).toContain("border-rule-strong");
  });

  it("speaks English with the English locale", async () => {
    const { t } = await import("@/lib/i18n");
    expect(t("orders.leave.title.other", { count: 2 }, "en")).toBe("2 dishes not sent");
    expect(t("orders.leave.title.one", { count: 1 }, "en")).toBe("1 dish not sent");
    expect(t("orders.leave.leave", {}, "en")).toBe("Leave anyway");
    expect(t("orders.leave.stay", {}, "en")).toBe("Stay at the table");
  });
});

describe("LeaveSheet, a send in flight and a failed send", () => {
  it("says a failed send inside the sheet, as an alert", () => {
    show({ error: "Qualcosa è andato storto. Riprova tra poco." });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("alert").textContent).toBe(
      "Qualcosa è andato storto. Riprova tra poco.",
    );
  });

  it("shows no alert when there is no error", () => {
    show();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("while busy the Invia buttons are disabled; leaving and staying are not", () => {
    const props = show({
      busy: true,
      groups: [
        { course: "antipasti", ids: ["a1"] },
        { course: "secondi", ids: ["s1"] },
      ],
    });
    expect(
      (screen.getByRole("button", { name: "Invia antipasti · 1" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Invia secondi · 1" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Esci comunque" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByRole("button", { name: "Resta al tavolo" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Invia antipasti · 1" }));
    expect(props.onSend).not.toHaveBeenCalled();
  });
});

describe("LeaveSheet, focus", () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return createElement(
      "div",
      null,
      createElement("button", { type: "button", onClick: () => setOpen(true) }, "Apri"),
      open &&
        createElement(LeaveSheet, {
          groups: [{ course: "antipasti", ids: ["a1"] }],
          onSend: () => undefined,
          onLeave: () => setOpen(false),
          onStay: () => setOpen(false),
        }),
    );
  }
  const openFromOpener = () => {
    render(createElement(Harness));
    const opener = screen.getByRole("button", { name: "Apri" });
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement?.textContent).toBe("1 piatto non inviato");
    return opener;
  };

  it("returns to the element that opened it on 'Resta al tavolo'", () => {
    const opener = openFromOpener();
    fireEvent.click(screen.getByRole("button", { name: "Resta al tavolo" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("returns to the opener on Escape", () => {
    const opener = openFromOpener();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(opener);
  });

  it("returns to the opener on a tap on the scrim", () => {
    const opener = openFromOpener();
    fireEvent.click(document.querySelector('[data-slot="leave-scrim"]')!);
    expect(document.activeElement).toBe(opener);
  });

  it("does not try to focus an opener that is gone", () => {
    const { unmount } = render(createElement("button", { type: "button" }, "Via"));
    const gone = screen.getByRole("button", { name: "Via" });
    gone.focus();
    const sheet = render(
      createElement(LeaveSheet, {
        groups: [{ course: "antipasti", ids: ["a1"] }],
        onSend: () => undefined,
        onLeave: () => undefined,
        onStay: () => undefined,
      }),
    );
    unmount();
    expect(() => sheet.unmount()).not.toThrow();
  });

  it("keeps Tab inside the sheet: from the last button to the first, and Shift+Tab back", () => {
    show({ groups: [{ course: "antipasti", ids: ["a1"] }] });
    const first = screen.getByRole("button", { name: "Invia antipasti · 1" });
    const last = screen.getByRole("button", { name: "Resta al tavolo" });
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("leaves Tab alone in the middle of the sheet", () => {
    show({ groups: [{ course: "antipasti", ids: ["a1"] }] });
    const middle = screen.getByRole("button", { name: "Esci comunque" });
    middle.focus();
    const event = createEvent.keyDown(middle, { key: "Tab" });
    fireEvent(middle, event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("pulls Tab back into the sheet when the focus is outside it", () => {
    render(createElement("button", { type: "button" }, "Fuori"));
    show({ groups: [{ course: "antipasti", ids: ["a1"] }] });
    const outside = screen.getByRole("button", { name: "Fuori" });
    outside.focus();
    fireEvent.keyDown(outside, { key: "Tab" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Invia antipasti · 1" }),
    );
  });
});
