// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LineEditor } from "@/app/(owner)/tavoli/[sessionId]/line-editor";
import { LINE_SOUP, LINE_STEW } from "../helpers/orders-data";

afterEach(cleanup);
type Props = Parameters<typeof LineEditor>[0];
const show = (over: Partial<Props> = {}) => {
  const props = {
    line: LINE_STEW,
    busy: false,
    onChange: vi.fn(),
    onRemove: vi.fn(),
    onDone: vi.fn(),
    ...over,
  };
  render(createElement(LineEditor, props));
  return props;
};

describe("LineEditor", () => {
  it("has the course Select pre-selected with the five courses", () => {
    show();
    const select = screen.getByRole("combobox", { name: /^Portata/ }) as HTMLSelectElement;
    expect(select.value).toBe("secondi");
    expect([...select.options].map((o) => o.value)).toEqual([
      "antipasti",
      "primi",
      "secondi",
      "dolci",
      "bevande",
    ]);
  });

  it("changing the course sends only the course", () => {
    const { onChange } = show();
    fireEvent.change(screen.getByRole("combobox", { name: /^Portata/ }), {
      target: { value: "dolci" },
    });
    expect(onChange).toHaveBeenCalledWith({ course: "dolci" });
  });

  it("the stepper moves by whole portions; '−' is disabled at one", () => {
    const { onChange } = show();
    fireEvent.click(screen.getByRole("button", { name: "Più una porzione" }));
    expect(onChange).toHaveBeenCalledWith({ qty: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Meno una porzione" }));
    expect(onChange).toHaveBeenLastCalledWith({ qty: 1 });
    cleanup();
    show({ line: { ...LINE_STEW, qty: 1 } });
    expect(
      (screen.getByRole("button", { name: "Meno una porzione" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("'Mezza porzione' is a toggle: pressed at 0.5, sets 0.5 or goes back to one", () => {
    const { onChange } = show();
    const toggle = screen.getByRole("button", { name: "Mezza porzione" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith({ qty: 0.5 });
    cleanup();
    const again = show({ line: LINE_SOUP });
    const pressed = screen.getByRole("button", { name: "Mezza porzione" });
    expect(pressed.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(pressed);
    expect(again.onChange).toHaveBeenCalledWith({ qty: 1 });
  });

  it("'Segue' and 'Piatto condiviso' are aria-pressed toggles that ask for the opposite", () => {
    const { onChange } = show({ line: LINE_SOUP });
    const segue = screen.getByRole("button", { name: "Segue" });
    const shared = screen.getByRole("button", { name: "Piatto condiviso" });
    expect(segue.getAttribute("aria-pressed")).toBe("true");
    expect(shared.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(segue);
    expect(onChange).toHaveBeenCalledWith({ segue: false });
    fireEvent.click(shared);
    expect(onChange).toHaveBeenLastCalledWith({ isShared: false });
  });

  it("the note field has maxlength 140 and the privacy hint, and is sent on blur", () => {
    const { onChange } = show({ line: LINE_SOUP });
    const note = screen.getByRole("textbox", { name: /^Nota/ }) as HTMLInputElement;
    expect(note.getAttribute("maxlength")).toBe("140");
    expect(note.value).toBe("senza cipolla");
    expect(
      screen.getByText("Solo indicazioni per la cucina, niente nomi dei clienti"),
    ).toBeTruthy();
    fireEvent.change(note, { target: { value: "ben cotto" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(note);
    expect(onChange).toHaveBeenCalledWith({ note: "ben cotto" });
  });

  it("Rimuovi and Fatto call back", () => {
    const { onRemove, onDone } = show();
    fireEvent.click(screen.getByRole("button", { name: "Rimuovi" }));
    expect(onRemove).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Fatto" }));
    expect(onDone).toHaveBeenCalled();
  });

  it("while busy every control is disabled", () => {
    show({ busy: true });
    for (const control of screen.getAllByRole("button"))
      expect((control as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("combobox", { name: /^Portata/ }) as HTMLSelectElement).disabled).toBe(
      true,
    );
  });

  it("every control is a 44 px target", () => {
    show();
    for (const control of [
      ...screen.getAllByRole("button"),
      screen.getByRole("combobox", { name: /^Portata/ }),
      screen.getByRole("textbox", { name: /^Nota/ }),
    ]) {
      expect(control.className, control.outerHTML).toContain("min-h-tap");
    }
  });

  it("shows the quantity as a number, half as ½", () => {
    show();
    expect(screen.getByText("2")).toBeTruthy();
    cleanup();
    show({ line: LINE_SOUP });
    expect(screen.getByText("½")).toBeTruthy();
  });
});
