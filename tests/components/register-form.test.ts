// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RegisterForm } from "@/app/(owner)/chiusura/register-form";

afterEach(cleanup);
type Props = Parameters<typeof RegisterForm>[0];
const show = (over: Partial<Props> = {}) =>
  render(
    createElement(RegisterForm, { busy: false, error: null, onSave: () => undefined, ...over }),
  );
const type = (value: string) =>
  fireEvent.change(screen.getByLabelText("Totale del registratore di cassa"), {
    target: { value },
  });
const save = () => fireEvent.click(screen.getByRole("button", { name: "Salva" }));

describe("RegisterForm", () => {
  it("has a labelled amount field with a decimal keyboard and a 'Salva' button", () => {
    show();
    const field = screen.getByLabelText("Totale del registratore di cassa") as HTMLInputElement;
    expect(field.getAttribute("inputmode")).toBe("decimal");
    expect(field.className).toContain("min-h-tap");
    expect(
      (screen.getByRole("button", { name: "Salva" }) as HTMLButtonElement).className,
    ).toContain("min-h-tap");
  });

  it.each([
    ["1.234,50", "1234.50"],
    ["1234,5", "1234.50"],
    ["1234.50", "1234.50"],
    ["0", "0.00"],
  ])("%j is sent as the decimal string %j", (typed, sent) => {
    const onSave = vi.fn();
    show({ onSave });
    type(typed);
    save();
    expect(onSave).toHaveBeenCalledWith(sent);
  });

  it.each([["abc"], [""], ["-5"], ["12,345"], ["10000000"]])(
    "%j shows the format message and sends nothing",
    (typed) => {
      const onSave = vi.fn();
      show({ onSave });
      type(typed);
      save();
      expect(onSave).not.toHaveBeenCalled();
      expect(screen.getByRole("alert").textContent).toBe("Scrivi un importo come 1.234,50");
    },
  );

  it("clears the message once a valid amount is saved", () => {
    const onSave = vi.fn();
    show({ onSave });
    type("x");
    save();
    type("10");
    save();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onSave).toHaveBeenCalledWith("10.00");
  });

  it("is off while saving and shows the server's refusal", () => {
    show({ busy: true, error: "La data non è valida: puoi scegliere fino a 62 giorni fa." });
    expect((screen.getByRole("button", { name: "Salva" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByRole("alert").textContent).toBe(
      "La data non è valida: puoi scegliere fino a 62 giorni fa.",
    );
  });
});
