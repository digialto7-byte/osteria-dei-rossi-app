// @vitest-environment jsdom
import { createElement, useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeLine } from "../helpers/review-line";

type Reply =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };
let reply: Reply;
const apiJson = vi.fn((_path: string, _init?: unknown): Promise<Reply> => Promise.resolve(reply));
vi.mock("@/lib/api/client", () => ({
  apiJson: (path: string, init?: unknown) => apiJson(path, init),
}));

import { LineEditor } from "@/app/(owner)/fatture/[id]/revisione/line-editor";
import { NewIngredientForm } from "@/app/(owner)/anagrafiche/new-ingredient-form";

const CREATED = {
  id: "1d000000-0000-4000-8000-0000000000aa",
  name: "Farina 00",
  baseUnit: "kg",
  isActive: true,
};
beforeEach(() => {
  apiJson.mockClear();
  reply = { ok: true, status: 201, data: { ingredient: CREATED } };
});
afterEach(cleanup);

describe("NewIngredientForm", () => {
  const open = (props: Record<string, unknown> = {}) => {
    const onCreated = vi.fn();
    const onCancel = vi.fn();
    render(createElement(NewIngredientForm, { onCreated, onCancel, ...props }));
    return { onCreated, onCancel };
  };

  it("has a Nome and an Unità field in a bordered group", () => {
    open();
    const group = screen.getByRole("group", { name: "Nuovo ingrediente" });
    expect(group.className).toContain("border");
    expect(screen.getByLabelText("Nome")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /^Unità/ })).toBeTruthy();
  });

  it("posts the trimmed name and the unit to /api/ingredients, then reports the new ingredient", async () => {
    const { onCreated } = open();
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "  Farina 00 " } });
    fireEvent.change(screen.getByRole("combobox", { name: /^Unità/ }), { target: { value: "kg" } });
    fireEvent.click(screen.getByRole("button", { name: "Crea ingrediente" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(apiJson).toHaveBeenCalledWith("/api/ingredients", {
      method: "POST",
      body: { name: "Farina 00", baseUnit: "kg" },
    });
    expect(onCreated).toHaveBeenCalledWith({ id: CREATED.id, name: "Farina 00", baseUnit: "kg" });
  });

  it("sends the unit that was chosen", async () => {
    open();
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Olio" } });
    fireEvent.change(screen.getByRole("combobox", { name: /^Unità/ }), { target: { value: "l" } });
    fireEvent.click(screen.getByRole("button", { name: "Crea ingrediente" }));
    await waitFor(() => expect(apiJson).toHaveBeenCalled());
    expect((apiJson.mock.calls[0]![1] as { body: unknown }).body).toEqual({
      name: "Olio",
      baseUnit: "l",
    });
  });

  it("sends nothing for an empty name and says so", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Crea ingrediente" }));
    expect(apiJson).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("nome");
  });

  it("shows the server's text in one alert on a 422 and keeps the form open", async () => {
    reply = {
      ok: false,
      status: 422,
      error: { code: "duplicate_name", message: "Esiste già un ingrediente con questo nome." },
    };
    const { onCreated } = open();
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Farina 00" } });
    fireEvent.click(screen.getByRole("button", { name: "Crea ingrediente" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Esiste già un ingrediente con questo nome.",
    );
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(onCreated).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Nome") as HTMLInputElement).value).toBe("Farina 00");
  });

  it("Enter in the name field creates the ingredient and does not submit an outer form", async () => {
    const outer = vi.fn((e: Event) => e.preventDefault());
    const onCreated = vi.fn();
    render(
      createElement(
        "form",
        { onSubmit: outer },
        createElement(NewIngredientForm, { onCreated, onCancel: vi.fn() }),
      ),
    );
    const name = screen.getByLabelText("Nome");
    fireEvent.change(name, { target: { value: "Farina 00" } });
    fireEvent.keyDown(name, { key: "Enter" });
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(outer).not.toHaveBeenCalled();
  });

  it("Annulla closes it without a request", () => {
    const { onCancel } = open();
    fireEvent.click(screen.getByRole("button", { name: "Annulla" }));
    expect(onCancel).toHaveBeenCalled();
    expect(apiJson).not.toHaveBeenCalled();
  });

  it("is not a form of its own, so it can sit inside the line editor's form", () => {
    const { container } = render(
      createElement(NewIngredientForm, { onCreated: vi.fn(), onCancel: vi.fn() }),
    );
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("button[type=submit]")).toBeNull();
  });
});

describe("the line editor creates an ingredient without leaving the review", () => {
  const ingredients = [{ id: "i1", name: "Manzo (fesa)", baseUnit: "kg" as const }];
  // The screen keeps the list the editors offer; a wrapper plays that part.
  const mount = () => {
    const saveLine = vi.fn(async () => null);
    const onIngredientCreated = vi.fn();
    function Screen() {
      const [list, setList] = useState(ingredients);
      return createElement(LineEditor, {
        line: makeLine({ ingredient: null, mappingSource: null }),
        ingredients: list,
        costCentres: [],
        actions: {
          saveLine,
          createCentre: async () => ({ id: "c" }),
          split: async () => null,
          unsplit: async () => null,
        },
        onClose: vi.fn(),
        onIngredientCreated: (created: (typeof ingredients)[number]) => {
          onIngredientCreated(created);
          setList((current) => [...current, created]);
        },
      } as never);
    }
    render(createElement(Screen));
    return { saveLine, onIngredientCreated };
  };

  it("has a Nuovo ingrediente button instead of a link out of the page", () => {
    mount();
    expect(screen.getByRole("button", { name: "Nuovo ingrediente" })).toBeTruthy();
    expect(document.querySelector('a[href="/anagrafiche/ingredienti"]')).toBeNull();
    expect(screen.queryByRole("group", { name: "Nuovo ingrediente" })).toBeNull();
  });

  it("opens the form, creates the ingredient, selects it and saves the line with it", async () => {
    const { saveLine, onIngredientCreated } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Nuovo ingrediente" }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Farina 00" } });
    fireEvent.click(screen.getByRole("button", { name: "Crea ingrediente" }));
    await waitFor(() =>
      expect(onIngredientCreated).toHaveBeenCalledWith({
        id: CREATED.id,
        name: "Farina 00",
        baseUnit: "kg",
      }),
    );
    expect(screen.queryByRole("group", { name: "Nuovo ingrediente" })).toBeNull();
    const select = screen.getByRole("combobox", { name: /^Ingrediente/ }) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe(CREATED.id));
    fireEvent.click(screen.getByRole("button", { name: "Salva riga" }));
    await waitFor(() => expect(saveLine).toHaveBeenCalled());
    expect((saveLine.mock.calls[0] as unknown[])[1]).toMatchObject({ ingredientId: CREATED.id });
  });

  it("shows a refusal inside the open form and leaves the line's choice alone", async () => {
    reply = { ok: false, status: 422, error: { code: "x", message: "Nome non valido." } };
    const { onIngredientCreated } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Nuovo ingrediente" }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Farina 00" } });
    fireEvent.click(screen.getByRole("button", { name: "Crea ingrediente" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Nome non valido.");
    expect(onIngredientCreated).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("combobox", { name: /^Ingrediente/ }) as HTMLSelectElement).value,
    ).toBe("");
  });
});
