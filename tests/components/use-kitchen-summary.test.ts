// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KITCHEN_TICKETS } from "../helpers/kitchen-data";

type Reply =
  { ok: true; status: 200; data: unknown } | { ok: false; status: number; error: unknown };
let next: () => Promise<Reply>;
const apiJson = vi.fn((_path: string, _options?: unknown) => next());
vi.mock("@/lib/api/client", () => ({
  apiJson: (path: string, options?: unknown) => apiJson(path, options),
}));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

import { useKitchenSummary } from "@/components/use-kitchen-summary";

const ok = (): Promise<Reply> => Promise.resolve({ ok: true, status: 200, data: KITCHEN_TICKETS });
let hidden = false;
const visibility = (isHidden: boolean) => {
  hidden = isHidden;
  act(() => void document.dispatchEvent(new Event("visibilitychange")));
};

beforeEach(() => {
  apiJson.mockClear();
  reportError.mockClear();
  next = ok;
  hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useKitchenSummary", () => {
  it("reads /api/kitchen/tickets once and goes loading to ok", async () => {
    const { result } = renderHook(() => useKitchenSummary(true));
    expect(result.current).toEqual({ status: "loading" });
    await waitFor(() =>
      expect(result.current).toEqual({ status: "ok", open: 2, remaining: 2, more: false }),
    );
    expect(apiJson.mock.calls.map(([p]) => p)).toEqual(["/api/kitchen/tickets"]);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("is idle and reads nothing when disabled", () => {
    const { result } = renderHook(() => useKitchenSummary(false));
    expect(result.current).toEqual({ status: "idle" });
    expect(apiJson).not.toHaveBeenCalled();
  });

  it("has no interval: ten minutes later it has still read once", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useKitchenSummary(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(result.current.status).toBe("ok");
    expect(apiJson).toHaveBeenCalledTimes(1);
  });

  it("reads once more when the page comes back to the front, and nothing while hidden", async () => {
    const { result } = renderHook(() => useKitchenSummary(true));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    visibility(true);
    expect(apiJson).toHaveBeenCalledTimes(1);
    visibility(false);
    expect(apiJson).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.status).toBe("ok"));
  });

  it("keeps showing the last numbers while a re-read is pending", async () => {
    const { result } = renderHook(() => useKitchenSummary(true));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    next = () => new Promise<Reply>(() => undefined);
    visibility(false);
    expect(result.current.status).toBe("ok");
  });

  it.each([
    ["a 500", () => Promise.resolve({ ok: false, status: 500, error: { code: "x" } } as Reply)],
    ["a network failure", () => Promise.resolve({ ok: false, status: 0, error: {} } as Reply)],
    [
      "a reply without tickets",
      () => Promise.resolve({ ok: true, status: 200, data: { nothing: 1 } } as Reply),
    ],
  ])("%s is an error, reported once with a code only", async (_name, reply) => {
    next = reply;
    const { result } = renderHook(() => useKitchenSummary(true));
    await waitFor(() => expect(result.current).toEqual({ status: "error" }));
    expect(reportError).toHaveBeenCalledTimes(1);
    const reported = reportError.mock.calls[0]?.[0] as Error;
    expect(reported).toBeInstanceOf(Error);
    expect(reported.message).toBe("home.kitchen_board");
    expect(reportError.mock.calls[0]).toHaveLength(1);
  });

  it("recovers when the next read succeeds", async () => {
    next = () => Promise.resolve({ ok: false, status: 500, error: {} });
    const { result } = renderHook(() => useKitchenSummary(true));
    await waitFor(() => expect(result.current.status).toBe("error"));
    next = ok;
    visibility(false);
    await waitFor(() => expect(result.current.status).toBe("ok"));
  });

  it("makes no request after unmount", async () => {
    const { result, unmount } = renderHook(() => useKitchenSummary(true));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    unmount();
    visibility(false);
    expect(apiJson).toHaveBeenCalledTimes(1);
  });
});
