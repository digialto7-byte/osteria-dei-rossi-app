// @vitest-environment jsdom
import { createElement, Suspense } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DETAIL } from "./payable-fixtures";

vi.mock("@/lib/api/client", () => ({
  apiJson: () => Promise.resolve({ ok: true, status: 200, data: DETAIL }),
}));

import PayablePage from "@/app/(owner)/pagamenti/[id]/page";

afterEach(cleanup);

async function open() {
  await act(async () => {
    render(
      createElement(
        Suspense,
        { fallback: null },
        createElement(PayablePage, { params: Promise.resolve({ id: DETAIL.payable.id }) }),
      ),
    );
  });
  await screen.findByRole("heading", { level: 1 });
}

describe("the payable page, the facts", () => {
  it("are one FactList: a muted label and a numeric value per fact, with the test ids", async () => {
    await open();
    const list = document.querySelector("dl")!;
    expect(list.className).toContain("grid-cols-[auto_minmax(min-content,1fr)]");
    expect(list.className).not.toContain("border-b");
    const card = list.closest(".rounded-card")!;
    expect(card.className).not.toContain("py-1");
    expect(card.className).toContain("gap-3");
    const link = screen.getByTestId("fact-invoice").querySelector("a");
    expect(link?.getAttribute("href")).toBe(`/fatture/${DETAIL.payable.invoiceId}`);
    expect(link?.textContent).toBe("123/A");
    expect(screen.getByTestId("fact-amount").tagName).toBe("DD");
    expect(screen.getByTestId("fact-amount").classList.contains("num")).toBe(true);
    for (const dt of list.querySelectorAll("dt"))
      expect(dt.classList.contains("text-ink-muted")).toBe(true);
  });

  it("leaves out a fact the payable does not have (no paid-on date while open)", async () => {
    await open();
    expect(screen.queryByTestId("fact-paid-on")).toBeNull();
  });
});
