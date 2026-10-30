// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LineRow } from "@/app/(owner)/tavoli/comanda/line-row";
import { LINE_SOUP, LINE_STEW } from "../helpers/orders-data";

afterEach(cleanup);
type Props = Parameters<typeof LineRow>[0];
const show = (over: Partial<Props> = {}) =>
  render(
    createElement(
      "ul",
      null,
      createElement(LineRow, {
        line: LINE_STEW,
        editing: false,
        onEdit: () => undefined,
        ...over,
      }),
    ),
  );

describe("LineRow", () => {
  it("shows 'qty × name' and carries the line id", () => {
    const { container } = show();
    expect(screen.getByText("2 × Spezzatino con polenta (demo)")).toBeTruthy();
    expect(container.querySelector(`[data-line-id="${LINE_STEW.id}"]`)).not.toBeNull();
  });

  it("shows ½, 'Da dividere', 'Segue' and the note of a half shared plate", () => {
    show({ line: LINE_SOUP });
    expect(screen.getByText("½ Zuppa del giorno (demo)")).toBeTruthy();
    expect(screen.getByText("Da dividere")).toBeTruthy();
    expect(screen.getByText("Segue")).toBeTruthy();
    expect(screen.getByText("senza cipolla")).toBeTruthy();
  });

  it("shows no badge and no note when the line has none", () => {
    show();
    expect(screen.queryByText("Da dividere")).toBeNull();
    expect(screen.queryByText("Segue")).toBeNull();
  });

  it("a draft line has an edit button named after the dish, 44 px tall, with aria-expanded", () => {
    const onEdit = vi.fn();
    show({ onEdit });
    const button = screen.getByRole("button", {
      name: /^Modifica .*Spezzatino con polenta \(demo\)/,
    });
    expect(button.className).toContain("min-h-tap");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(onEdit).toHaveBeenCalledWith(LINE_STEW.id);
  });

  it("an open editor sets aria-expanded", () => {
    show({ editing: true });
    expect(screen.getByRole("button", { name: /^Modifica/ }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("a fired line is locked: no edit button, 'In cucina' (M19 words it so; it was 'Inviata')", () => {
    show({ line: { ...LINE_STEW, state: "fired" } });
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("In cucina")).toBeTruthy();
  });

  it("a sent line has a 'Storna' button, 44 px tall, when the page can void; it calls onVoid with the id", () => {
    const onVoid = vi.fn();
    show({ line: { ...LINE_STEW, state: "fired" }, onVoid });
    expect(screen.queryByRole("button", { name: /^Modifica/ })).toBeNull();
    const button = screen.getByRole("button", { name: /^Storna/ });
    expect(button.className).toContain("min-h-tap");
    fireEvent.click(button);
    expect(onVoid).toHaveBeenCalledWith(LINE_STEW.id);
  });

  it("a draft line has no 'Storna' button (a draft is removed, not voided)", () => {
    show({ onVoid: () => undefined });
    expect(screen.queryByRole("button", { name: /^Storna/ })).toBeNull();
  });

  it("a voided line is struck through and says 'Stornato', with no button", () => {
    const { container } = show({
      line: { ...LINE_STEW, state: "voided" },
      onVoid: () => undefined,
    });
    expect(screen.getByText("Stornato")).toBeTruthy();
    expect(container.querySelector(".line-through")).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows the void dialog under a sent line while voiding", () => {
    show({
      line: { ...LINE_STEW, state: "fired" },
      onVoid: () => undefined,
      voiding: true,
      children: createElement("div", { "data-testid": "dialog" }),
    });
    expect(screen.getByTestId("dialog")).toBeTruthy();
  });

  it("renders a note as text", () => {
    const { container } = show({ line: { ...LINE_STEW, note: "<b>x</b>" } });
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText("<b>x</b>")).toBeTruthy();
  });
});

// M20 (plan §3.6.5, step 19): the badges of a line whose operations are waiting in the outbox. "In coda per la cucina" never reads
// "In cucina" (the kitchen does not have it yet); "Scarta" is only on a queued add; there is no "Riprova" (the queue retries by itself).
describe("LineRow: queued lines", () => {
  const queued = (extra: object = {}) => ({
    ...LINE_STEW,
    queue: "add" as const,
    queuedAddOpId: "0e0",
    ...extra,
  });

  it("a queued add says 'In coda' and offers 'Scarta', not 'Riprova'", () => {
    const onDiscard = vi.fn();
    show({ line: queued(), onDiscard });
    expect(screen.getByText("In coda")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Riprova" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Scarta" }));
    expect(onDiscard).toHaveBeenCalledWith(LINE_STEW.id);
  });

  it("a queued edit says 'In coda' and has no 'Scarta' (only an add can be thrown away)", () => {
    show({ line: queued({ queue: "edit", queuedAddOpId: undefined }), onDiscard: () => undefined });
    expect(screen.getByText("In coda")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Scarta" })).toBeNull();
  });

  it("a queued fire says 'In coda per la cucina', never 'In cucina', and the line stays a draft that is not editable", () => {
    show({ line: queued({ queue: "fire", queuedAddOpId: undefined }) });
    expect(screen.getByText("In coda per la cucina")).toBeTruthy();
    expect(screen.queryByText("In cucina")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Modifica/ })).toBeNull();
  });

  it("an add that is queued and then fired still offers 'Scarta' (it was never sent)", () => {
    show({ line: queued({ queue: "fire" }), onDiscard: () => undefined });
    expect(screen.getByText("In coda per la cucina")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Scarta" })).toBeTruthy();
  });

  it("a queued void says 'Storno in coda'", () => {
    show({ line: { ...LINE_STEW, state: "fired", queue: "void" as const } });
    expect(screen.getByText("Storno in coda")).toBeTruthy();
    expect(screen.getByText("In cucina")).toBeTruthy(); // the kitchen does have it: that part is true
  });

  it("a queued line is still editable when only an add or an edit is waiting", () => {
    show({ line: queued() });
    expect(screen.getByRole("button", { name: /^Modifica/ })).toBeTruthy();
  });

  it("no queued text contains a euro sign, 'Costo' or 'Margine'", () => {
    const { container } = show({ line: queued({ queue: "fire" }), onDiscard: () => undefined });
    expect(container.textContent).not.toMatch(/€|Costo|Margine|Food cost/);
  });
});
