// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RECONCILIATION_EDGE } from "../fixtures/exports";

type Result =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };
const ok = (data: unknown): Result => ({ ok: true, status: 200, data });
const PLACE_A = "10000000-0000-4000-8000-0000000000a1";
const PLACE_B = "10000000-0000-4000-8000-0000000000a2";

let role = "owner";
let places = [{ id: PLACE_A, name: "Cella (demo)" }];
const calls: string[] = [];
const apiJson = vi.fn((path: string): Promise<Result> => {
  calls.push(path);
  if (path.startsWith("/api/locations")) return Promise.resolve(ok({ locations: places }));
  if (path.startsWith("/api/reports/reconciliation"))
    return Promise.resolve(ok(RECONCILIATION_EDGE));
  return Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "x" } });
});
vi.mock("@/lib/api/client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api/client")>("@/lib/api/client")),
  apiJson: (path: string) => apiJson(path),
}));
vi.mock("@/components/use-me", () => ({
  useMe: () => ({
    status: "ok",
    me: {
      user: { id: "u", displayName: "Titolare Demo", role },
      tenant: { id: "t", name: "Osteria Demo A" },
    },
    retry: () => undefined,
  }),
}));

import ReconciliationPage from "@/app/(owner)/magazzino/riconciliazione/page";

beforeEach(() => {
  role = "owner";
  places = [{ id: PLACE_A, name: "Cella (demo)" }];
  calls.length = 0;
  apiJson.mockClear();
});
afterEach(cleanup);

describe("the reconciliation page: CSV link (M24)", () => {
  it("links reconciliation.csv with the reply's from and to (one location: no location)", async () => {
    render(createElement(ReconciliationPage));
    const link = await screen.findByRole("link", { name: "Scarica CSV" });
    expect(link.getAttribute("href")).toBe(
      "/api/exports/reconciliation.csv?from=2026-10-01&to=2026-10-31",
    );
    expect(link.hasAttribute("download")).toBe(true);
  });

  it("with two locations the link carries the location the screen reads", async () => {
    places = [
      { id: PLACE_A, name: "Cella (demo)" },
      { id: PLACE_B, name: "Dispensa (demo)" },
    ];
    render(createElement(ReconciliationPage));
    const link = await screen.findByRole("link", { name: "Scarica CSV" });
    expect(link.getAttribute("href")).toBe(
      `/api/exports/reconciliation.csv?from=2026-10-01&to=2026-10-31&location=${PLACE_A}`,
    );
    await waitFor(() => expect(calls.some((c) => c.includes(`location=${PLACE_A}`))).toBe(true));
  });

  it("the chef gets no link", async () => {
    role = "chef";
    render(createElement(ReconciliationPage));
    await screen.findByText(/Burro/);
    expect(screen.queryByRole("link", { name: "Scarica CSV" })).toBeNull();
  });
});
