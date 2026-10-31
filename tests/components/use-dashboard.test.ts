// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DASHBOARD_REFRESH_MS } from "@/server/dashboard/constants";
import { renderDashboard } from "@/server/dashboard/render";
import { dashboardSqlSchema } from "@/server/dashboard/sql-schema";
import { adminSql, ownerSql } from "../fixtures/dashboard-sql";

type Reply =
  { ok: true; status: 200; data: unknown } | { ok: false; status: number; error: unknown };
const GOOD = renderDashboard(dashboardSqlSchema.parse(ownerSql()), "it");
const ADMIN = renderDashboard(dashboardSqlSchema.parse(adminSql()), "it");
let next: () => Promise<Reply>;
let opensReply: () => Promise<Reply>;
const apiJson = vi.fn((path: string, _options?: unknown) =>
  path === "/api/dashboard/opens" ? opensReply() : next(),
);
vi.mock("@/lib/api/client", () => ({
  apiJson: (path: string, options?: unknown) => apiJson(path, options),
}));

import { useDashboard } from "@/components/use-dashboard";

const ok = (): Promise<Reply> => Promise.resolve({ ok: true, status: 200, data: GOOD });
let hidden = false;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-09T07:00:00Z"));
  apiJson.mockClear();
  next = ok;
  opensReply = () =>
    Promise.resolve({ ok: true, status: 200, data: { isoWeek: "2026-11-09", opens: 1 } });
  hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const focus = () => act(() => void window.dispatchEvent(new Event("focus")));
const reads = () => apiJson.mock.calls.filter(([p]) => p === "/api/dashboard").length;
const posts = () => apiJson.mock.calls.filter(([p]) => p === "/api/dashboard/opens");
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
    expect(apiJson.mock.calls.filter(([p]) => p === "/api/dashboard").map(([p]) => [p])).toEqual([
      ["/api/dashboard"],
    ]);
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
    expect(reads()).toBe(2);
  });

  it("refetches on focus no more than once per DASHBOARD_REFRESH_MS", async () => {
    const { result } = renderHook(() => useDashboard(true));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    focus();
    await settle();
    expect(reads()).toBe(1);
    vi.setSystemTime(Date.now() + DASHBOARD_REFRESH_MS - 1);
    focus();
    await settle();
    expect(reads()).toBe(1);
    vi.setSystemTime(Date.now() + 1);
    focus();
    await settle();
    expect(reads()).toBe(2);
    focus();
    await settle();
    expect(reads()).toBe(2);
  });

  it("does not fetch while the document is hidden", async () => {
    const { result } = renderHook(() => useDashboard(true));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    vi.setSystemTime(Date.now() + 10 * DASHBOARD_REFRESH_MS);
    hidden = true;
    focus();
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    await settle();
    expect(reads()).toBe(1);
    hidden = false;
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    await settle();
    expect(reads()).toBe(2);
  });

  it("keeps the numbers on screen when a background refresh fails", async () => {
    const { result } = renderHook(() => useDashboard(true));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    next = () => Promise.resolve({ ok: false, status: 500, error: { code: "x", message: "x" } });
    vi.setSystemTime(Date.now() + DASHBOARD_REFRESH_MS);
    focus();
    await settle();
    await settle();
    expect(reads()).toBe(2);
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
    expect(reads()).toBe(1);
  });
  describe("when the effect is cleaned up and run again with a read in flight", () => {
    let release: (reply: Reply) => void = () => {};
    const slow = () => new Promise<Reply>((resolve) => (release = resolve));

    it("StrictMode's double mount ends with the data applied, from one request", async () => {
      next = slow;
      const { result } = renderHook(() => useDashboard(true), { wrapper: StrictMode });
      expect(result.current.status).toBe("loading");
      await act(async () => release(await ok()));
      await waitFor(() => expect(result.current.status).toBe("ok"));
      expect(reads()).toBe(1);
    });

    it("StrictMode with a failed first read ends in error, and retry recovers", async () => {
      next = () => Promise.resolve({ ok: false, status: 500, error: { code: "x", message: "x" } });
      const { result } = renderHook(() => useDashboard(true), { wrapper: StrictMode });
      await waitFor(() => expect(result.current.status).toBe("error"));
      next = ok;
      act(() => result.current.retry());
      await waitFor(() => expect(result.current.status).toBe("ok"));
    });

    it("enabled toggling off and on during a read still ends with the data applied", async () => {
      next = slow;
      const { result, rerender } = renderHook(({ on }) => useDashboard(on), {
        initialProps: { on: true },
      });
      rerender({ on: false });
      rerender({ on: true });
      await act(async () => release(await ok()));
      await waitFor(() => expect(result.current.status).toBe("ok"));
    });

    it("a reply that lands after unmount is dropped without an error", async () => {
      next = slow;
      const { unmount } = renderHook(() => useDashboard(true));
      unmount();
      await act(async () => release(await ok()));
      expect(reads()).toBe(1);
    });
  });
});

describe("the opens count (AT9, client side)", () => {
  it("an owner mount reads the dashboard, then posts one open", async () => {
    const { result } = renderHook(() => useDashboard(true));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(apiJson.mock.calls.map(([p]) => p)).toEqual(["/api/dashboard", "/api/dashboard/opens"]);
    expect(posts()[0]![1]).toEqual({ method: "POST", body: {} });
  });

  it("a focus refresh reads again and does not post a second time", async () => {
    const { result } = renderHook(() => useDashboard(true));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    await waitFor(() => expect(posts()).toHaveLength(1));
    vi.setSystemTime(Date.now() + DASHBOARD_REFRESH_MS);
    focus();
    await settle();
    await settle();
    expect(reads()).toBe(2);
    expect(posts()).toHaveLength(1);
  });

  it("an admin mount posts nothing", async () => {
    next = () => Promise.resolve({ ok: true, status: 200, data: ADMIN });
    const { result } = renderHook(() => useDashboard(true));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    await settle();
    expect(posts()).toHaveLength(0);
  });

  it("nothing is posted before the first successful read, or when the read fails", async () => {
    next = () => Promise.resolve({ ok: false, status: 500, error: { code: "x", message: "x" } });
    const { result } = renderHook(() => useDashboard(true));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(posts()).toHaveLength(0);
  });

  it("StrictMode's double mount posts once", async () => {
    const { result } = renderHook(() => useDashboard(true), { wrapper: StrictMode });
    await waitFor(() => expect(result.current.status).toBe("ok"));
    await waitFor(() => expect(posts()).toHaveLength(1));
    await settle();
    expect(posts()).toHaveLength(1);
  });

  it("a failed post leaves the page rendered, with no error", async () => {
    opensReply = () =>
      Promise.resolve({ ok: false, status: 500, error: { code: "x", message: "x" } });
    const { result } = renderHook(() => useDashboard(true));
    await waitFor(() => expect(posts()).toHaveLength(1));
    await settle();
    expect(result.current.status).toBe("ok");
    expect(result.current.data).not.toBeNull();
  });

  it("a post that throws is swallowed too", async () => {
    opensReply = () => Promise.reject(new Error("offline"));
    const { result } = renderHook(() => useDashboard(true));
    await waitFor(() => expect(posts()).toHaveLength(1));
    await settle();
    expect(result.current.status).toBe("ok");
  });
});
