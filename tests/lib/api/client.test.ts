import { afterEach, describe, expect, it, vi } from "vitest";
import { apiJson, apiUpload } from "@/lib/api/client";

const reply = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe("apiJson", () => {
  it("GETs JSON and returns the data", async () => {
    const fetchMock = reply(200, { locations: [] });
    const result = await apiJson<{ locations: [] }>("/api/locations", {}, fetchMock);
    expect(result).toEqual({ ok: true, status: 200, data: { locations: [] } });
    expect(fetchMock).toHaveBeenCalledWith("/api/locations", {
      method: "GET",
      headers: { accept: "application/json" },
      body: undefined,
    });
  });

  it("sends a JSON body with the JSON content type (the CSRF rule)", async () => {
    const fetchMock = reply(201, { location: { id: "1" } });
    await apiJson("/api/locations", { method: "POST", body: { name: "Cella" } }, fetchMock);
    expect(fetchMock).toHaveBeenCalledWith("/api/locations", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ name: "Cella" }),
    });
  });

  it("passes the API error through, with its details", async () => {
    const error = { code: "import_invalid", message: "Righe non valide", details: [{ row: 3 }] };
    const result = await apiJson("/api/x", { method: "POST", body: {} }, reply(422, { error }));
    expect(result).toEqual({ ok: false, status: 422, error });
  });

  it("turns a network failure or a non-JSON reply into an error result", async () => {
    const offline = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    expect(await apiJson("/api/x", {}, offline)).toMatchObject({
      ok: false,
      status: 0,
      error: { code: "network" },
    });
    const html = vi.fn().mockResolvedValue(new Response("<html>", { status: 502 }));
    expect(await apiJson("/api/x", {}, html)).toMatchObject({
      ok: false,
      status: 502,
      error: { code: "bad_response" },
    });
  });

  it("a 204 has no data", async () => {
    const empty = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    expect(await apiJson("/api/x", { method: "POST", body: {} }, empty)).toEqual({
      ok: true,
      status: 204,
      data: undefined,
    });
  });
});

describe("apiUpload", () => {
  const form = () => {
    const data = new FormData();
    data.append("file", new File(["%PDF-1.4"], "fattura.pdf", { type: "application/pdf" }));
    return data;
  };

  it("POSTs the FormData as is, with no content-type (the browser adds the boundary)", async () => {
    const fetchMock = reply(202, { invoice: { id: "1" } });
    const body = form();
    const result = await apiUpload<{ invoice: { id: string } }>("/api/invoices", body, fetchMock);
    expect(result).toEqual({ ok: true, status: 202, data: { invoice: { id: "1" } } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0]!;
    expect(path).toBe("/api/invoices");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(body);
    expect(init.headers).toEqual({ accept: "application/json" });
    expect(Object.keys(init.headers).map((h) => h.toLowerCase())).not.toContain("content-type");
  });

  it("passes the API error body through", async () => {
    const error = { code: "unsupported_file_type", message: "Formato non supportato." };
    const result = await apiUpload("/api/invoices", form(), reply(415, { error }));
    expect(result).toEqual({ ok: false, status: 415, error });
  });

  it("turns a network failure or a non-JSON reply into an error result", async () => {
    const offline = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    expect(await apiUpload("/api/invoices", form(), offline)).toMatchObject({
      ok: false,
      status: 0,
      error: { code: "network" },
    });
    const html = vi.fn().mockResolvedValue(new Response("<html>", { status: 413 }));
    expect(await apiUpload("/api/invoices", form(), html)).toMatchObject({
      ok: false,
      status: 413,
      error: { code: "bad_response" },
    });
  });
});

describe("session_ended (M11 staff sessions)", () => {
  const assign = vi.fn();
  const stubWindow = (pathname: string) =>
    vi.stubGlobal("window", { location: { pathname, assign } });
  afterEach(() => {
    vi.unstubAllGlobals();
    assign.mockReset();
  });

  const ended = () =>
    reply(401, { error: { code: "session_ended", message: "Sessione terminata." } });

  it("navigates to /pin on 401 session_ended and still returns the error result", async () => {
    stubWindow("/ricette");
    const result = await apiJson("/api/recipes", {}, ended());
    expect(assign).toHaveBeenCalledWith("/pin");
    expect(result).toMatchObject({ ok: false, status: 401, error: { code: "session_ended" } });
  });

  it("does not navigate when already on /pin (no reload loop)", async () => {
    stubWindow("/pin");
    await apiJson("/api/recipes", {}, ended());
    expect(assign).not.toHaveBeenCalled();
  });

  it("other 401s do not navigate", async () => {
    stubWindow("/ricette");
    await apiJson(
      "/api/recipes",
      {},
      reply(401, { error: { code: "unauthenticated", message: "x" } }),
    );
    expect(assign).not.toHaveBeenCalled();
  });

  it("uploads behave the same", async () => {
    stubWindow("/fatture");
    await apiUpload("/api/invoices", new FormData(), ended());
    expect(assign).toHaveBeenCalledWith("/pin");
  });

  it("is silent without a window (server rendering)", async () => {
    const result = await apiJson("/api/recipes", {}, ended());
    expect(result.ok).toBe(false);
  });
});
