// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MenuItemButton } from "@/app/(owner)/tavoli/comanda/menu-item-button";
import {
  DESSERT_ITEM,
  PASTA_ITEM,
  SOUP_ITEM,
  STEAK_ITEM,
  STEW_ITEM,
} from "../helpers/order-components";

afterEach(cleanup);
const show = (item = STEW_ITEM, onAdd = () => undefined, pinned = false) =>
  render(createElement(MenuItemButton, { item, onAdd, pinned }));

describe("MenuItemButton", () => {
  it("is named 'Aggiungi <dish>' and carries the item id", () => {
    show();
    const button = screen.getByRole("button", { name: "Aggiungi Spezzatino con polenta (demo)" });
    expect(button.getAttribute("data-menu-item-id")).toBe(STEW_ITEM.id);
    expect(button.className).toContain("min-h-tap");
  });

  it("shows the price as the venue writes it", () => {
    show();
    expect(screen.getByText(/^14,00\s€$/)).toBeTruthy();
  });

  it("shows 'Ne restano 3' only when the database says lowStock", () => {
    show();
    expect(screen.getByText("Ne restano 3")).toBeTruthy();
    cleanup();
    show(SOUP_ITEM);
    expect(screen.queryByText(/Ne rest/)).toBeNull();
    cleanup();
    show({ ...STEW_ITEM, lowStock: false, portionsLeft: 3 });
    expect(screen.queryByText(/Ne rest/)).toBeNull();
  });

  it("tapping adds the dish", () => {
    const onAdd = vi.fn();
    show(SOUP_ITEM, onAdd);
    fireEvent.click(screen.getByRole("button", { name: /^Aggiungi Zuppa/ }));
    expect(onAdd).toHaveBeenCalledWith(SOUP_ITEM);
  });

  it("an unavailable dish says 'Esaurito', is aria-disabled and adds nothing", () => {
    const onAdd = vi.fn();
    show(PASTA_ITEM, onAdd);
    const button = screen.getByRole("button", { name: /^Aggiungi Tagliatelle/ });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("Esaurito")).toBeTruthy();
    fireEvent.click(button);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("an available dish is not aria-disabled", () => {
    show();
    expect(
      screen.getByRole("button", { name: /^Aggiungi/ }).getAttribute("aria-disabled"),
    ).not.toBe("true");
  });

  it("a pushed dish shows its push price and the pinned marker when pinned", () => {
    show(DESSERT_ITEM, () => undefined, true);
    const button = screen.getByRole("button", { name: /^Aggiungi Tiramisù/ });
    expect(button.getAttribute("data-pinned")).toBe("true");
    expect(screen.getByText(/^4,50\s€$/)).toBeTruthy();
    expect(button.textContent).toContain("★");
  });

  it("a dish name is rendered as text, never as markup", () => {
    const { container } = show({ ...SOUP_ITEM, name: "<script>alert(1)</script>" });
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByRole("button", { name: "Aggiungi <script>alert(1)</script>" })).toBeTruthy();
  });
});

describe("MenuItemButton, a dish sold by weight (P2-0b)", () => {
  const plain = (text: string | null) => (text ?? "").replaceAll("\u00a0", " ");

  it("shows the price per 100 g, never a bare price", () => {
    const { container } = render(
      createElement(MenuItemButton, { item: STEAK_ITEM, onAdd: () => undefined }),
    );
    expect(plain(container.textContent)).toContain("4,25 € / 100 g");
    expect(plain(container.textContent)).not.toMatch(/(^|[^/] )4,25 €$/);
  });

  it("shows the push price per 100 g while pushed", () => {
    const { container } = render(
      createElement(MenuItemButton, {
        item: { ...STEAK_ITEM, pushed: true, pushPrice: 3.9 },
        onAdd: () => undefined,
      }),
    );
    expect(plain(container.textContent)).toContain("3,90 € / 100 g");
  });

  it("says 'Restano circa 1,4 kg' from weightLeftG instead of the portions", () => {
    show(STEAK_ITEM);
    expect(plain(document.body.textContent)).toContain("Restano circa 1,4 kg");
    expect(screen.queryByText(/Ne rest/)).toBeNull();
  });

  it("says nothing about stock when it is not low", () => {
    show({ ...STEAK_ITEM, lowStock: false });
    expect(screen.queryByText(/Restano/)).toBeNull();
  });

  it("a tap still reports the dish; the page opens the weight sheet", () => {
    const onAdd = vi.fn();
    show(STEAK_ITEM, onAdd);
    fireEvent.click(screen.getByRole("button", { name: /^Aggiungi Bistecca/ }));
    expect(onAdd).toHaveBeenCalledWith(STEAK_ITEM);
  });
});
