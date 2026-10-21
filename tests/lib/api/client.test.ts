import { describe, expect, it, vi } from "vitest";
import { apiJson } from "@/lib/api/client";

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
