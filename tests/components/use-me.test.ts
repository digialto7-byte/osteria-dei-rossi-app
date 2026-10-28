// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMe, useMe } from "@/components/use-me";

const ME = {
  user: { id: "a0000000-0000-4000-8000-000000000001", displayName: "Utente Demo", role: "chef" },
  tenant: { id: "b0000000-0000-4000-8000-000000000001", name: "Osteria Demo", isDemo: false },
};

const reply = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

const fetchMock = vi.fn<(path: string) => Promise<Response>>();

function Probe({ id }: { id: string }) {
  const { status, me } = useMe();
  return createElement("p", { "data-testid": id }, `${status}:${me?.user.role ?? "-"}`);
}

beforeEach(() => {
  resetMe();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useMe", () => {
  it("starts as loading, with no user", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    render(createElement(Probe, { id: "a" }));
    expect(screen.getByTestId("a").textContent).toBe("loading:-");
  });

  it("reads /api/me once for two components", async () => {
    fetchMock.mockImplementation(() => reply(200, ME));
    render(
      createElement(
        "div",
        null,
        createElement(Probe, { id: "a" }),
        createElement(Probe, { id: "b" }),
      ),
    );
    await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("ok:chef"));
    await waitFor(() => expect(screen.getByTestId("b").textContent).toBe("ok:chef"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/me");
  });

  it("does not read again when a component mounts later, and has the answer at once", async () => {
    fetchMock.mockImplementation(() => reply(200, ME));
    const first = render(createElement(Probe, { id: "a" }));
    await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("ok:chef"));
    first.unmount();
    render(createElement(Probe, { id: "b" }));
    expect(screen.getByTestId("b").textContent).toBe("ok:chef");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a 401 is signedOut", async () => {
    fetchMock.mockImplementation(() =>
      reply(401, { error: { code: "unauthenticated", message: "no" } }),
    );
    render(createElement(Probe, { id: "a" }));
    await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("signedOut:-"));
  });

  it("a 403 is noAccess", async () => {
    fetchMock.mockImplementation(() => reply(403, { error: { code: "forbidden", message: "no" } }));
    render(createElement(Probe, { id: "a" }));
    await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("noAccess:-"));
  });

  it("reads again after resetMe, so the next person never inherits the previous role", async () => {
    fetchMock.mockImplementation(() => reply(200, ME));
    const first = render(createElement(Probe, { id: "a" }));
    await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("ok:chef"));
    first.unmount();

    resetMe();
    fetchMock.mockImplementation(() => reply(200, { ...ME, user: { ...ME.user, role: "waiter" } }));
    render(createElement(Probe, { id: "b" }));
    expect(screen.getByTestId("b").textContent).toBe("loading:-");
    await waitFor(() => expect(screen.getByTestId("b").textContent).toBe("ok:waiter"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("an answer that arrives after resetMe is not kept for the next person", async () => {
    let release: (response: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const first = render(createElement(Probe, { id: "a" }));
    resetMe();
    release(new Response(JSON.stringify(ME), { status: 200 }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    first.unmount();

    fetchMock.mockImplementation(() => reply(403, { error: { code: "forbidden", message: "no" } }));
    render(createElement(Probe, { id: "b" }));
    await waitFor(() => expect(screen.getByTestId("b").textContent).toBe("noAccess:-"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not keep a network failure: the next mount tries again", async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new TypeError("offline")));
    const first = render(createElement(Probe, { id: "a" }));
    await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("signedOut:-"));
    first.unmount();

    fetchMock.mockImplementation(() => reply(200, ME));
    render(createElement(Probe, { id: "b" }));
    await waitFor(() => expect(screen.getByTestId("b").textContent).toBe("ok:chef"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
