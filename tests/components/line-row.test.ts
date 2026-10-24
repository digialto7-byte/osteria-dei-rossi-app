// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LineRow } from "@/app/(owner)/tavoli/[sessionId]/line-row";
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
        pending: false,
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

  it("a pending line says 'Invio…' and cannot be edited yet", () => {
    show({ pending: true });
    expect(screen.getByText("Invio…")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
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

  it("a fired line is locked: no edit button, 'Inviata'", () => {
    show({ line: { ...LINE_STEW, state: "fired" } });
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Inviata")).toBeTruthy();
  });

  it("renders a note as text", () => {
    const { container } = show({ line: { ...LINE_STEW, note: "<b>x</b>" } });
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText("<b>x</b>")).toBeTruthy();
  });
});
