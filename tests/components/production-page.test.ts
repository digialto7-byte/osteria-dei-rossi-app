// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BatchProposal } from "@/server/batches/types";
import { KEY, PROPOSAL } from "./batch-fixtures";

type Result = { ok: true; data: unknown };
const pending: Array<{ path: string; resolve: (r: Result) => void }> = [];
const apiJson = vi.fn((path: string) => {
  if (path.startsWith("/api/recipes")) {
    return Promise.resolve({
      ok: true,
      data: { recipes: [{ key: KEY, name: "Spezzatino (demo)" }] },
    });
  }
  return new Promise<Result>((resolve) => pending.push({ path, resolve }));
});

vi.mock("@/lib/api/client", () => ({ apiJson: (path: string) => apiJson(path) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import NewProductionPage from "@/app/(owner)/produzione/nuova/page";

beforeEach(() => {
  pending.length = 0;
  apiJson.mockClear();
});
afterEach(cleanup);

const field = <T extends HTMLElement = HTMLInputElement>(name: string) =>
  document.querySelector(`[name="${name}"]`) as T;
const calcButton = () => screen.getByRole("button", { name: "Calcola" });
const answer = (index: number, data: unknown) =>
  act(async () => {
    pending[index]!.resolve({ ok: true, data });
  });

describe("Nuova produzione page: a shelf-life refresh while a calculation is pending", () => {
  it("keeps the pending calculation: the page is not left busy and the new proposal is shown", async () => {
    render(createElement(NewProductionPage));
    await waitFor(() => expect(field("recipe")).not.toBeNull());
    fireEvent.change(field("recipe"), { target: { value: KEY } });
    fireEvent.change(field("output"), { target: { value: "6,2" } });
    fireEvent.click(calcButton());
    await answer(0, PROPOSAL);
    await waitFor(() => expect(field("portions").value).toBe("31"));

    // A second Calcola, left pending ...
    fireEvent.change(field("output"), { target: { value: "7" } });
    fireEvent.click(calcButton());
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(calcButton()).toHaveProperty("disabled", true);

    // ... then the chef edits the shelf life and leaves the field.
    fireEvent.change(field("shelfLife"), { target: { value: "48" } });
    fireEvent.blur(field("shelfLife"));
    await waitFor(() => expect(pending).toHaveLength(3));

    const next: BatchProposal = { ...PROPOSAL, outputQty: 7, portionsComputed: 35 };
    await answer(1, next);
    await answer(2, { ...PROPOSAL, shelfLifeHours: 48, useByPreview: "2026-10-25T09:12:00+00:00" });

    await waitFor(() => expect(field("portions").value).toBe("35"));
    expect(field("output").value).toBe("7");
    expect(calcButton()).toHaveProperty("disabled", false);
  });

  it("does not let a late shelf-life answer overwrite a newer proposal", async () => {
    render(createElement(NewProductionPage));
    await waitFor(() => expect(field("recipe")).not.toBeNull());
    fireEvent.change(field("recipe"), { target: { value: KEY } });
    fireEvent.change(field("output"), { target: { value: "6,2" } });
    fireEvent.click(calcButton());
    await answer(0, PROPOSAL);
    await waitFor(() => expect(field("portions").value).toBe("31"));

    fireEvent.change(field("shelfLife"), { target: { value: "48" } });
    fireEvent.blur(field("shelfLife"));
    await waitFor(() => expect(pending).toHaveLength(2));
    fireEvent.change(field("output"), { target: { value: "7" } });
    fireEvent.click(calcButton());
    await waitFor(() => expect(pending).toHaveLength(3));

    await answer(2, { ...PROPOSAL, outputQty: 7, portionsComputed: 35 });
    await answer(1, { ...PROPOSAL, shelfLifeHours: 48 });

    await waitFor(() => expect(field("portions").value).toBe("35"));
    expect(field("output").value).toBe("7");
  });
});
