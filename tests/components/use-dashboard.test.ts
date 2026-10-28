// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DASHBOARD_REFRESH_MS } from "@/server/dashboard/constants";
import { renderDashboard } from "@/server/dashboard/render";
import { dashboardSqlSchema } from "@/server/dashboard/sql-schema";
import { ownerSql } from "../fixtures/dashboard-sql";

type Reply =
  { ok: true; status: 200; data: unknown } | { ok: false; status: number; error: unknown };
const GOOD = renderDashboard(dashboardSqlSchema.parse(ownerSql()), "it");
let next: () => Promise<Reply>;
const apiJson = vi.fn((_path: string) => next());
vi.mock("@/lib/api/client", () => ({ apiJson: (path: string) => apiJson(path) }));

import { useDashboard } from "@/components/use-dashboard";

const ok = (): Promise<Reply> => Promise.resolve({ ok: true, status: 200, data: GOOD });
let hidden = false;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-09T07:00:00Z"));
  apiJson.mockClear();
  next = ok;
  hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const focus = () => act(() => void window.dispatchEvent(new Event("focus")));
const settle = () => act(async () => void (await Promise.resolve()));

describe("useDashboard", () => {
  it("is idle and reads nothing when not enabled", () => {
    const { result } = renderHook(() => useDashboard(false));
    expect(result.current.status).toBe("idle");
    expect(apiJson).not.toHaveBeenCalled();
  });

  it("reads /api/dashboard once on mount and validates the reply", async () => {
    const { result } = renderHook(() => useDashboard(true));
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(apiJson.mock.calls).toEqual([["/api/dashboard"]]);
    expect(result.current.data?.role).toBe("owner");
  });

  it("a reply of the wrong shape is an error, not data", async () => {
    next = () => Promise.resolve({ ok: true, status: 200, data: { nothing: true } });
    const { result } = renderHook(() => useDashboard(true));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.data).toBeNull();
  });

  it("a failed read is an error and retry reads again", async () => {
    next = () => Promise.resolve({ ok: false, status: 500, error: { code: "x", message: "x" } });
    const { result } = renderHook(() => useDashboard(true));
    await waitFor(() => expect(result.current.status).toBe("error"));
    next = ok;
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(apiJson).toHaveBeenCalledTimes(2);
  });

  it("refetches on focus no more than once per DASHBOARD_REFRESH_MS", async () => {
    const { result } = renderHook(() => useDashboard(true));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    focus();
    await settle();
    expect(apiJson).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + DASHBOARD_REFRESH_MS - 1);
    focus();
    await settle();
    expect(apiJson).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 1);
    focus();
    await settle();
    expect(apiJson).toHaveBeenCalledTimes(2);
    focus();
    await settle();
    expect(apiJson).toHaveBeenCalledTimes(2);
  });

  it("does not fetch while the document is hidden", async () => {
    const { result } = renderHook(() => useDashboard(true));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    vi.setSystemTime(Date.now() + 10 * DASHBOARD_REFRESH_MS);
    hidden = true;
    focus();
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    await settle();
    expect(apiJson).toHaveBeenCalledTimes(1);
    hidden = false;
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    await settle();
    expect(apiJson).toHaveBeenCalledTimes(2);
  });

  it("keeps the numbers on screen when a background refresh fails", async () => {
    const { result } = renderHook(() => useDashboard(true));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    next = () => Promise.resolve({ ok: false, status: 500, error: { code: "x", message: "x" } });
    vi.setSystemTime(Date.now() + DASHBOARD_REFRESH_MS);
    focus();
    await settle();
    await settle();
    expect(apiJson).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("ok");
    expect(result.current.data).not.toBeNull();
  });

  it("stops listening when unmounted", async () => {
    const { result, unmount } = renderHook(() => useDashboard(true));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    unmount();
    vi.setSystemTime(Date.now() + DASHBOARD_REFRESH_MS);
    focus();
    await settle();
    expect(apiJson).toHaveBeenCalledTimes(1);
  });
});
