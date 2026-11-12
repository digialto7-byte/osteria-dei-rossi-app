import { afterEach, describe, expect, it, vi } from "vitest";
import { apiJson, apiUpload, detailList, detailObject } from "@/lib/api/client";

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

  it("reports when the service worker answered from its copy (x-offline-cached-at), and only then", async () => {
    const cached = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ a: 1 }), {
        status: 200,
        headers: { "x-offline-cached-at": "2026-11-02T19:31:00.000Z" },
      }),
    );
    expect(await apiJson("/api/menu", {}, cached)).toEqual({
      ok: true,
      status: 200,
      data: { a: 1 },
      cachedAt: "2026-11-02T19:31:00.000Z",
    });
    const live = await apiJson("/api/menu", {}, reply(200, { a: 1 }));
    expect(live).toEqual({ ok: true, status: 200, data: { a: 1 } });
    expect(live).not.toHaveProperty("cachedAt");
  });

  it("copes with a reply that has no headers object (a bare fake)", async () => {
    const bare = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ a: 1 }) });
    expect(await apiJson("/api/x", {}, bare)).toEqual({ ok: true, status: 200, data: { a: 1 } });
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

  it("keeps an object in details (an order conflict carries the current line)", async () => {
    const details = { reason: "stale", line: { id: "l1", qty: 2 } };
    const error = { code: "conflict", message: "Riga cambiata", details };
    const result = await apiJson("/api/x", { method: "PATCH", body: {} }, reply(409, { error }));
    expect(result).toEqual({ ok: false, status: 409, error });
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

describe("session_ended (M11 staff sessions) and session_expired (M25a)", () => {
  const assign = vi.fn();
  const stubWindow = (pathname: string) =>
    vi.stubGlobal("window", { location: { pathname, assign } });
  afterEach(() => {
    vi.unstubAllGlobals();
    assign.mockReset();
  });

  const ended = () =>
    reply(401, { error: { code: "session_ended", message: "Sessione terminata." } });
  const expired = () =>
    reply(401, { error: { code: "session_expired", message: "La sessione è scaduta." } });

  it("navigates to /login on 401 session_ended and still returns the error result", async () => {
    stubWindow("/ricette");
    const result = await apiJson("/api/recipes", {}, ended());
    expect(assign).toHaveBeenCalledWith("/login");
    expect(result).toMatchObject({ ok: false, status: 401, error: { code: "session_ended" } });
  });

  it("does not navigate when already on /login (no reload loop)", async () => {
    stubWindow("/login");
    await apiJson("/api/recipes", {}, ended());
    expect(assign).not.toHaveBeenCalled();
  });

  it("navigates to /login?errore=sessione on 401 session_expired", async () => {
    stubWindow("/fatture");
    const result = await apiJson("/api/invoices", {}, expired());
    expect(assign).toHaveBeenCalledWith("/login?errore=sessione");
    expect(result).toMatchObject({ ok: false, status: 401, error: { code: "session_expired" } });
  });

  it("session_expired does not navigate when already on /login", async () => {
    stubWindow("/login");
    await apiJson("/api/me", {}, expired());
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
    expect(assign).toHaveBeenCalledWith("/login");
  });

  it("is silent without a window (server rendering)", async () => {
    const result = await apiJson("/api/recipes", {}, ended());
    expect(result.ok).toBe(false);
  });
});

describe("mfa_required and mfa_enrol_required (P2-1 A9)", () => {
  const assign = vi.fn();
  const stubWindow = (pathname: string, search = "") =>
    vi.stubGlobal("window", { location: { pathname, search, assign } });
  afterEach(() => {
    vi.unstubAllGlobals();
    assign.mockReset();
  });
  const mfa = (code: string) => reply(403, { error: { code, message: "x" } });

  it("403 mfa_required on /oggi goes to the code page, once, with the way back", async () => {
    stubWindow("/oggi");
    const result = await apiJson("/api/me", {}, mfa("mfa_required"));
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("/login/codice?next=%2Foggi");
    expect(result).toMatchObject({ ok: false, status: 403, error: { code: "mfa_required" } });
  });

  it("the way back keeps the query string", async () => {
    stubWindow("/ricette", "?q=pasta");
    await apiJson("/api/me", {}, mfa("mfa_required"));
    expect(assign).toHaveBeenCalledWith("/login/codice?next=%2Fricette%3Fq%3Dpasta");
  });

  it("403 mfa_enrol_required goes to the forced enrolment page", async () => {
    stubWindow("/oggi");
    await apiJson("/api/me", {}, mfa("mfa_enrol_required"));
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("/login/attiva-codice?next=%2Foggi");
  });

  it.each(["/login", "/login/codice", "/login/attiva-codice", "/login/offerta-codice"])(
    "does not navigate when already under %s (no redirect loop)",
    async (path) => {
      stubWindow(path);
      await apiJson("/api/me/mfa", {}, mfa("mfa_required"));
      await apiJson("/api/me/mfa", {}, mfa("mfa_enrol_required"));
      expect(assign).not.toHaveBeenCalled();
    },
  );

  it("other 403s do not navigate", async () => {
    stubWindow("/oggi");
    await apiJson("/api/x", {}, reply(403, { error: { code: "forbidden", message: "x" } }));
    await apiJson("/api/x", {}, reply(403, { error: { code: "no_tenant", message: "x" } }));
    expect(assign).not.toHaveBeenCalled();
  });

  it("a 401 mfa_required (wrong status) does not navigate", async () => {
    stubWindow("/oggi");
    await apiJson("/api/x", {}, reply(401, { error: { code: "mfa_required", message: "x" } }));
    expect(assign).not.toHaveBeenCalled();
  });

  it("is silent without a window (server rendering)", async () => {
    const result = await apiJson("/api/me", {}, mfa("mfa_required"));
    expect(result.ok).toBe(false);
  });
});

describe("apiJson DELETE", () => {
  it("sends a DELETE with no body but with the JSON content-type the API requires (CSRF guard)", async () => {
    const fetchMock = reply(200, { device: { id: "1" } });
    const result = await apiJson("/api/devices/1", { method: "DELETE" }, fetchMock);
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/api/devices/1", {
      method: "DELETE",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: undefined,
    });
  });

  it.each(["POST", "PATCH", "PUT"] as const)(
    "a body-less %s also declares JSON",
    async (method) => {
      const fetchMock = reply(200, {});
      await apiJson("/api/x", { method }, fetchMock);
      const init = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
      expect(init.headers["content-type"]).toBe("application/json");
    },
  );

  it("a GET stays free of content-type", async () => {
    const fetchMock = reply(200, {});
    await apiJson("/api/x", {}, fetchMock);
    const init = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(init.headers).toEqual({ accept: "application/json" });
  });
});

describe("detailList and detailObject", () => {
  it("detailList returns a list of details and nothing else", () => {
    expect(detailList([{ row: 3 }])).toEqual([{ row: 3 }]);
    expect(detailList({ reason: "stale" })).toBeUndefined();
    expect(detailList(undefined)).toBeUndefined();
    expect(detailList("x")).toBeUndefined();
  });

  it("detailObject returns the parsed object when the schema accepts it", () => {
    const schema = {
      safeParse: (value: unknown) =>
        typeof value === "object" && value !== null && "reason" in value
          ? { success: true as const, data: value as { reason: string } }
          : { success: false as const },
    };
    expect(detailObject({ reason: "stale" }, schema)).toEqual({ reason: "stale" });
    expect(detailObject([{ row: 1 }], schema)).toBeUndefined();
    expect(detailObject(undefined, schema)).toBeUndefined();
  });
});
