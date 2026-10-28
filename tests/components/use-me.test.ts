// @vitest-environment jsdom
import { createElement, StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  const { status, me, retry } = useMe();
  return createElement(
    "p",
    { "data-testid": id, onClick: retry },
    `${status}:${me?.user.role ?? "-"}`,
  );
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
    first.unmount();
    resetMe();
    release(new Response(JSON.stringify(ME), { status: 200 }));

    fetchMock.mockImplementation(() => reply(403, { error: { code: "forbidden", message: "no" } }));
    render(createElement(Probe, { id: "b" }));
    await waitFor(() => expect(screen.getByTestId("b").textContent).toBe("noAccess:-"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a network failure is error, not signedOut, and is not kept: the next mount tries again", async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new TypeError("offline")));
    const first = render(createElement(Probe, { id: "a" }));
    await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("error:-"));
    first.unmount();

    fetchMock.mockImplementation(() => reply(200, ME));
    render(createElement(Probe, { id: "b" }));
    await waitFor(() => expect(screen.getByTestId("b").textContent).toBe("ok:chef"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([500, 502, 503])("a %i is error, not signedOut", async (status) => {
    fetchMock.mockImplementation(() => reply(status, { error: { code: "boom", message: "x" } }));
    render(createElement(Probe, { id: "a" }));
    await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("error:-"));
  });

  it("retry reads again and shows the answer", async () => {
    fetchMock.mockImplementationOnce(() => reply(500, { error: { code: "boom", message: "x" } }));
    render(createElement(Probe, { id: "a" }));
    await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("error:-"));
    fetchMock.mockImplementation(() => reply(200, ME));
    fireEvent.click(screen.getByTestId("a"));
    await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("ok:chef"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403])("a %i is not kept either: the next mount asks again", async (status) => {
    fetchMock.mockImplementationOnce(() => reply(status, { error: { code: "x", message: "x" } }));
    const first = render(createElement(Probe, { id: "a" }));
    await waitFor(() => expect(screen.getByTestId("a").textContent).not.toBe("loading:-"));
    first.unmount();
    fetchMock.mockImplementation(() => reply(200, ME));
    render(createElement(Probe, { id: "b" }));
    expect(screen.getByTestId("b").textContent).toBe("loading:-");
    await waitFor(() => expect(screen.getByTestId("b").textContent).toBe("ok:chef"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a component mounted before resetMe never shows the previous person's late answer", async () => {
    let release: (response: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    render(createElement(Probe, { id: "a" }));
    fetchMock.mockImplementation(() => reply(200, { ...ME, user: { ...ME.user, role: "waiter" } }));
    // resetMe with a component on screen asks again at once; the previous person's answer then arrives.
    resetMe();
    release(new Response(JSON.stringify(ME), { status: 200 }));
    await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("ok:waiter"));
    expect(screen.getByTestId("a").textContent).not.toContain("chef");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("one answer reaches every mounted component, also after a retry from one of them", async () => {
    fetchMock.mockImplementationOnce(() => reply(500, { error: { code: "boom", message: "x" } }));
    render(
      createElement(
        "div",
        null,
        createElement(Probe, { id: "a" }),
        createElement(Probe, { id: "b" }),
      ),
    );
    await waitFor(() => expect(screen.getByTestId("b").textContent).toBe("error:-"));
    expect(screen.getByTestId("a").textContent).toBe("error:-");
    fetchMock.mockImplementation(() => reply(200, ME));
    fireEvent.click(screen.getByTestId("a"));
    await waitFor(() => expect(screen.getByTestId("b").textContent).toBe("ok:chef"));
    expect(screen.getByTestId("a").textContent).toBe("ok:chef");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("resetMe with components on screen reaches all of them", async () => {
    fetchMock.mockImplementation(() => reply(200, ME));
    render(
      createElement(
        "div",
        null,
        createElement(Probe, { id: "a" }),
        createElement(Probe, { id: "b" }),
      ),
    );
    await waitFor(() => expect(screen.getByTestId("b").textContent).toBe("ok:chef"));
    fetchMock.mockImplementation(() => reply(200, { ...ME, user: { ...ME.user, role: "waiter" } }));
    resetMe();
    await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("ok:waiter"));
    expect(screen.getByTestId("b").textContent).toBe("ok:waiter");
  });

  it("survives StrictMode's double mount with one request and the right answer", async () => {
    fetchMock.mockImplementation(() => reply(200, ME));
    render(createElement(StrictMode, null, createElement(Probe, { id: "a" })));
    await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("ok:chef"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("StrictMode does not strand a failed read either: retry still works", async () => {
    fetchMock.mockImplementationOnce(() => reply(500, { error: { code: "boom", message: "x" } }));
    render(createElement(StrictMode, null, createElement(Probe, { id: "a" })));
    await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("error:-"));
    fetchMock.mockImplementation(() => reply(200, ME));
    fireEvent.click(screen.getByTestId("a"));
    await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("ok:chef"));
  });

  // X1: a 401, 403 or error that lands after the last component has gone must not be what the next mount renders first
  // (after logout then an e-mail login the shell flashed "Accedi" for one frame).
  describe("an unhappy answer that lands with nobody mounted", () => {
    const firstRenders: string[] = [];
    function Logged() {
      const { status } = useMe();
      firstRenders.push(status);
      return createElement("p", null, status);
    }

    it.each([
      [401, "signedOut"],
      [403, "noAccess"],
      [500, "error"],
    ])(
      "a late %i is not published: the next mount's first render is loading (%s)",
      async (status) => {
        let release: (response: Response) => void = () => {};
        fetchMock.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
        const first = render(createElement(Probe, { id: "a" }));
        first.unmount();
        release(new Response(JSON.stringify({ error: { code: "x", message: "x" } }), { status }));
        await new Promise((resolve) => setTimeout(resolve, 0));

        firstRenders.length = 0;
        fetchMock.mockImplementation(() => reply(200, ME));
        render(createElement(Logged));
        expect(firstRenders[0]).toBe("loading");
        expect(firstRenders).not.toContain(
          status === 401 ? "signedOut" : status === 403 ? "noAccess" : "error",
        );
        await waitFor(() => expect(screen.getByText("ok")).toBeTruthy());
      },
    );

    it("also after a retry whose answer lands once the screen is gone", async () => {
      fetchMock.mockImplementationOnce(() => reply(500, { error: { code: "boom", message: "x" } }));
      const first = render(createElement(Probe, { id: "a" }));
      await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("error:-"));
      let release: (response: Response) => void = () => {};
      fetchMock.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
      fireEvent.click(screen.getByTestId("a"));
      first.unmount();
      release(
        new Response(JSON.stringify({ error: { code: "x", message: "x" } }), { status: 401 }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      firstRenders.length = 0;
      fetchMock.mockImplementation(() => reply(200, ME));
      render(createElement(Logged));
      expect(firstRenders[0]).toBe("loading");
    });

    it("a successful answer that lands with nobody mounted is still kept", async () => {
      let release: (response: Response) => void = () => {};
      fetchMock.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
      render(createElement(Probe, { id: "a" })).unmount();
      release(new Response(JSON.stringify(ME), { status: 200 }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      firstRenders.length = 0;
      render(createElement(Logged));
      expect(firstRenders[0]).toBe("ok");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
