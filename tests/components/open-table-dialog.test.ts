// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenTableDialog } from "@/app/(owner)/tavoli/open-table-dialog";

type Props = Parameters<typeof OpenTableDialog>[0];
const props = (over: Partial<Props> = {}): Props => ({
  table: { id: "7a000000-0000-4000-8000-000000000002", name: "Tavolo 2 (demo)" },
  busy: false,
  error: null,
  onSubmit: () => undefined,
  onCancel: () => undefined,
  generateId: () => "5e000000-0000-4000-8000-0000000000aa",
  ...over,
});
afterEach(cleanup);

describe("OpenTableDialog markup", () => {
  const html = renderToStaticMarkup(createElement(OpenTableDialog, props()));
  it("names the table, has a numeric Coperti field with 44 px steppers and Apri tavolo", () => {
    expect(html).toContain("Apri Tavolo 2 (demo)");
    expect(html).toContain("Coperti");
    expect(html).toMatch(/<input[^>]*inputMode="numeric"/);
    expect(html).toMatch(
      /<button[^>]*min-h-tap[^>]*aria-label="Meno un coperto"[^>]*>−<\/button>|<button[^>]*aria-label="Meno un coperto"[^>]*min-h-tap[^>]*>−<\/button>/,
    );
    expect(html).toMatch(/aria-label="Più un coperto"[^>]*>\+<\/button>/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Apri tavolo<\/button>/);
  });
});

describe("OpenTableDialog behaviour", () => {
  it("opens with the covers typed and a session id", () => {
    const onSubmit = vi.fn();
    render(createElement(OpenTableDialog, props({ onSubmit })));
    fireEvent.change(screen.getByLabelText("Coperti"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Apri tavolo" }));
    expect(onSubmit).toHaveBeenCalledWith("5e000000-0000-4000-8000-0000000000aa", 4);
  });

  it("the + and − buttons step the covers within 1 to 99", () => {
    const onSubmit = vi.fn();
    render(createElement(OpenTableDialog, props({ onSubmit })));
    const field = screen.getByLabelText("Coperti") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Meno un coperto" }));
    expect(field.value).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Più un coperto" }));
    expect(field.value).toBe("2");
    fireEvent.change(field, { target: { value: "99" } });
    fireEvent.click(screen.getByRole("button", { name: "Più un coperto" }));
    expect(field.value).toBe("99");
  });

  it("the session id is the same on a retry: it is made once", () => {
    const onSubmit = vi.fn();
    const generateId = vi.fn(() => "5e000000-0000-4000-8000-0000000000bb");
    render(createElement(OpenTableDialog, props({ onSubmit, generateId })));
    fireEvent.change(screen.getByLabelText("Coperti"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Apri tavolo" }));
    fireEvent.click(screen.getByRole("button", { name: "Apri tavolo" }));
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[0]![0]).toBe(onSubmit.mock.calls[1]![0]);
    expect(generateId).toHaveBeenCalledTimes(1);
  });

  it.each(["0", "100", "", "abc", "2,5"])(
    "refuses %j with the Italian message and no call",
    (text) => {
      const onSubmit = vi.fn();
      render(createElement(OpenTableDialog, props({ onSubmit })));
      fireEvent.change(screen.getByLabelText("Coperti"), { target: { value: text } });
      fireEvent.click(screen.getByRole("button", { name: "Apri tavolo" }));
      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByRole("alert").textContent).toBe("I coperti vanno da 1 a 99.");
    },
  );

  it("shows the server's error and Annulla calls onCancel", () => {
    const onCancel = vi.fn();
    render(createElement(OpenTableDialog, props({ onCancel, error: "Il tavolo non è attivo." })));
    expect(screen.getByRole("alert").textContent).toBe("Il tavolo non è attivo.");
    fireEvent.click(screen.getByRole("button", { name: "Annulla" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables the buttons while opening", () => {
    render(createElement(OpenTableDialog, props({ busy: true })));
    expect(screen.getByRole("button", { name: "Apri tavolo" })).toHaveProperty("disabled", true);
  });
});
