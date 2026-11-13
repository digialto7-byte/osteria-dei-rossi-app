// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// QW3 (docs/plans/2026-11-13-ux-quick-wins.md): Home reads the booking-request count from the existing endpoint, for owner and admin only.
type Reply =
  { ok: true; status: 200; data: unknown } | { ok: false; status: number; error: unknown };
let reply: () => Promise<Reply>;
const apiJson = vi.fn((_path: string) => reply());
vi.mock("@/lib/api/client", () => ({ apiJson: (path: string) => apiJson(path) }));

import { usePendingRequests } from "@/components/use-pending-requests";

beforeEach(() => {
  apiJson.mockClear();
  reply = () => Promise.resolve({ ok: true, status: 200, data: { pending: 2 } });
});
afterEach(cleanup);

describe("usePendingRequests", () => {
  it("is idle and asks nothing when not enabled (the chef, the waiter, the role not known yet)", () => {
    const { result } = renderHook(() => usePendingRequests(false));
    expect(result.current).toEqual({ status: "idle", pending: null });
    expect(apiJson).not.toHaveBeenCalled();
  });

  it("when enabled, reads GET /api/reservations/pending-count once and gives the number", async () => {
    const { result } = renderHook(() => usePendingRequests(true));
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current).toEqual({ status: "ok", pending: 2 }));
    expect(apiJson.mock.calls.map(([p]) => p)).toEqual(["/api/reservations/pending-count"]);
  });

  it("an error reply is the state `error`, with no number", async () => {
    reply = () =>
      Promise.resolve({ ok: false, status: 500, error: { code: "internal", message: "x" } });
    const { result } = renderHook(() => usePendingRequests(true));
    await waitFor(() => expect(result.current).toEqual({ status: "error", pending: null }));
  });

  it("a forbidden reply is an error too, not a zero", async () => {
    reply = () =>
      Promise.resolve({ ok: false, status: 403, error: { code: "forbidden", message: "x" } });
    const { result } = renderHook(() => usePendingRequests(true));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.pending).toBeNull();
  });

  it("a reply that is not {pending: number} is an error", async () => {
    reply = () => Promise.resolve({ ok: true, status: 200, data: { pending: "two" } });
    const { result } = renderHook(() => usePendingRequests(true));
    await waitFor(() => expect(result.current.status).toBe("error"));
  });
});
