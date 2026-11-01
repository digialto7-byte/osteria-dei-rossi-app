// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VARIANCE_COSTS_EDGE, VARIANCE_EDGE } from "../fixtures/exports";

type Result =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };
const ok = (data: unknown): Result => ({ ok: true, status: 200, data });
const SESSION = VARIANCE_EDGE.session.id;

let role = "owner";
const calls: string[] = [];
const apiJson = vi.fn((path: string): Promise<Result> => {
  calls.push(path);
  if (path.startsWith("/api/reports/variance-costs"))
    return Promise.resolve(ok(VARIANCE_COSTS_EDGE));
  if (path.startsWith("/api/reports/variance")) return Promise.resolve(ok(VARIANCE_EDGE));
  if (path === "/api/me") return Promise.resolve(ok({ user: { role } }));
  return Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "x" } });
});
vi.mock("@/lib/api/client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api/client")>("@/lib/api/client")),
  apiJson: (path: string) => apiJson(path),
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: SESSION }) }));
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

import VariancePage from "@/app/(owner)/magazzino/conteggi/[id]/scostamenti/page";

beforeEach(() => {
  role = "owner";
  calls.length = 0;
  apiJson.mockClear();
});
afterEach(cleanup);

describe("the count variance page: CSV link (M24)", () => {
  it("links count-variance.csv?session=<id> once the variance is read", async () => {
    render(createElement(VariancePage));
    const link = await screen.findByRole("link", { name: "Scarica CSV" });
    expect(link.getAttribute("href")).toBe(`/api/exports/count-variance.csv?session=${SESSION}`);
    expect(link.hasAttribute("download")).toBe(true);
  });

  it("shows no link before the variance has loaded", () => {
    render(createElement(VariancePage));
    expect(screen.queryByRole("link", { name: "Scarica CSV" })).toBeNull();
  });

  it("the chef gets no link, and the page makes no euro request", async () => {
    role = "chef";
    render(createElement(VariancePage));
    await waitFor(() => expect(calls).toContain(`/api/reports/variance?session=${SESSION}`));
    await screen.findByText(/Burro/);
    expect(screen.queryByRole("link", { name: "Scarica CSV" })).toBeNull();
    expect(calls.some((c) => c.startsWith("/api/reports/variance-costs"))).toBe(false);
  });
});
