// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PinnedStrip } from "@/app/(owner)/tavoli/comanda/pinned-strip";
import { DESSERT_ITEM, STEW_ITEM } from "../helpers/order-components";

afterEach(cleanup);

describe("PinnedStrip", () => {
  it("shows 'Da proporre' with a star, the dish and the push price", () => {
    render(createElement(PinnedStrip, { items: [DESSERT_ITEM], onAdd: () => undefined }));
    const region = screen.getByRole("region", { name: "Da proporre" });
    expect(region.textContent).toContain("★");
    expect(region.textContent).toContain("Da proporre");
    expect(screen.getByRole("button", { name: "Aggiungi Tiramisù (demo)" })).toBeTruthy();
    expect(screen.getByText(/^4,50\s€$/)).toBeTruthy();
  });

  it("keeps the order the API sent", () => {
    const second = { ...STEW_ITEM, pushed: true, pushPrice: 12 };
    render(createElement(PinnedStrip, { items: [DESSERT_ITEM, second], onAdd: () => undefined }));
    const ids = screen
      .getAllByRole("button")
      .map((button) => button.getAttribute("data-menu-item-id"));
    expect(ids).toEqual([DESSERT_ITEM.id, STEW_ITEM.id]);
  });

  it("is absent when nothing is pinned", () => {
    const { container } = render(createElement(PinnedStrip, { items: [], onAdd: () => undefined }));
    expect(container.innerHTML).toBe("");
  });

  it("tapping a pinned dish adds it", () => {
    const onAdd = vi.fn();
    render(createElement(PinnedStrip, { items: [DESSERT_ITEM], onAdd }));
    fireEvent.click(screen.getByRole("button"));
    expect(onAdd).toHaveBeenCalledWith(DESSERT_ITEM);
  });

  it("a pushed dish at 0 portions stays in the strip, greyed", () => {
    const out = {
      ...DESSERT_ITEM,
      available: false,
      unavailableReason: "no_portions" as const,
      portionsLeft: 0,
    };
    render(createElement(PinnedStrip, { items: [out], onAdd: () => undefined }));
    expect(screen.getByRole("button").getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("Esaurito")).toBeTruthy();
  });
});
