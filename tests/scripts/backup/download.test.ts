import { describe, expect, it } from "vitest";
import { isSafeObjectPath, makeDownloadObject } from "../../../scripts/lib/backup/download";

// Fake data only: a fake project URL and a fake key.
const URL_BASE = "https://abcdefghijklmnopqrst.supabase.co";
const KEY = "test-key-sb-secret-0123456789";
const PREFIX = "/storage/v1/object/invoices/";

type Call = { url: string; init: RequestInit | undefined };

function fakeFetch(status = 200, body = "bytes") {
  const calls: Call[] = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(status === 200 ? body : "nope", { status });
  }) as typeof fetch;
  return { fetchFn, calls };
}

describe("makeDownloadObject", () => {
  it("does a plain GET on the authenticated object endpoint with the key in apikey and Authorization", async () => {
    const f = fakeFetch(200, "pdf-bytes");
    const download = makeDownloadObject({ fetch: f.fetchFn, url: URL_BASE, key: KEY });
    const bytes = await download("t1/2026/a.pdf");
    expect(new TextDecoder().decode(bytes)).toBe("pdf-bytes");
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url).toBe(`${URL_BASE}${PREFIX}t1/2026/a.pdf`);
    expect(f.calls[0]!.init?.method ?? "GET").toBe("GET");
    const headers = new Headers(f.calls[0]!.init?.headers);
    expect(headers.get("apikey")).toBe(KEY);
    expect(headers.get("authorization")).toBe(`Bearer ${KEY}`);
  });

  it("accepts a base URL with a trailing slash", async () => {
    const f = fakeFetch();
    await makeDownloadObject({ fetch: f.fetchFn, url: `${URL_BASE}/`, key: KEY })("a/b.pdf");
    expect(f.calls[0]!.url).toBe(`${URL_BASE}${PREFIX}a/b.pdf`);
  });

  it.each([
    "a?b.pdf",
    "a#b.pdf",
    "100%.pdf",
    "cartella con spazi/fattura è.pdf",
    "a/%2e%2e/b",
    "a/b c/%41.pdf",
    "x\\y.pdf",
  ])("keeps %j under the invoices prefix with every segment encoded", async (path) => {
    const f = fakeFetch();
    await makeDownloadObject({ fetch: f.fetchFn, url: URL_BASE, key: KEY })(path);
    const u = new URL(f.calls[0]!.url);
    expect(u.origin).toBe(URL_BASE);
    expect(u.search).toBe("");
    expect(u.hash).toBe("");
    expect(u.pathname.startsWith(PREFIX)).toBe(true);
    const rest = u.pathname.slice(PREFIX.length);
    expect(rest.split("/").length).toBe(path.split("/").length);
    expect(rest.split("/").map(decodeURIComponent).join("/")).toBe(path);
  });

  it.each(["../x", "a/../b", "a//b", "./a", "/a", "a/.", "a/", ""])(
    "refuses %j before any request",
    async (path) => {
      const f = fakeFetch();
      const download = makeDownloadObject({ fetch: f.fetchFn, url: URL_BASE, key: KEY });
      await expect(download(path)).rejects.toThrow("download_failed:invalid_path");
      expect(f.calls).toEqual([]);
    },
  );

  it.each([404, 500])("a %i error carries only the status: no key, URL or path", async (status) => {
    const f = fakeFetch(status);
    const download = makeDownloadObject({ fetch: f.fetchFn, url: URL_BASE, key: KEY });
    const error = await download("secret-tenant/Mario Rossi.pdf").catch((e: Error) => e);
    expect((error as Error).message).toBe(`download_failed:${status}`);
    const text = JSON.stringify(error) + String(error) + (error as Error).stack;
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("supabase.co");
    expect(text).not.toContain("Mario");
  });

  it("a network failure is rethrown without the URL, key or path", async () => {
    const fetchFn = (async (url: string | URL) => {
      throw new Error(`connect failed ${String(url)} ${KEY}`);
    }) as typeof fetch;
    const download = makeDownloadObject({ fetch: fetchFn, url: URL_BASE, key: KEY });
    const error = (await download("a/Mario.pdf").catch((e: Error) => e)) as Error;
    expect(error.message).toBe("download_failed:network");
    expect(String(error.stack)).not.toContain(KEY);
  });

  it("sends the key only in the headers, never in the URL", async () => {
    const f = fakeFetch();
    await makeDownloadObject({ fetch: f.fetchFn, url: URL_BASE, key: KEY })("a/b.pdf");
    expect(f.calls[0]!.url).not.toContain(KEY);
    expect(JSON.stringify(f.calls[0]!.init?.body ?? null)).not.toContain(KEY);
  });
});

describe("isSafeObjectPath", () => {
  it("allows legal key characters and refuses empty, dot and dot-dot segments and a leading slash", () => {
    for (const ok of ["a?b", "a#b", "100%", "a/b c/è", "a/%2e%2e/b", "a/...", "a/.b"])
      expect(isSafeObjectPath(ok), ok).toBe(true);
    for (const bad of ["../x", "a/../b", "a//b", "./a", "/a", "a/.", "a/", ""])
      expect(isSafeObjectPath(bad), bad).toBe(false);
  });
});
