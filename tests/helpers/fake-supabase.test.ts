import { describe, expect, it } from "vitest";
import { fakeSupabase } from "./fake-supabase";

describe("fakeSupabase storage and range filters", () => {
  it("exposes gte, lt and gt as chain spies", () => {
    const client = fakeSupabase();
    type Chain = Record<"select" | "gte" | "lt" | "gt", (...args: unknown[]) => Chain>;
    const q = client.from("invoice") as unknown as Chain;
    q.select("id").gte("created_at", "a").lt("created_at", "b").gt("n", 1);
    expect(client.query.gte).toHaveBeenCalledWith("created_at", "a");
    expect(client.query.lt).toHaveBeenCalledWith("created_at", "b");
    expect(client.query.gt).toHaveBeenCalledWith("n", 1);
  });

  it("returns scripted upload results in order, the last one repeating", async () => {
    const client = fakeSupabase({
      storage: {
        upload: [
          { data: { path: "p" }, error: null },
          { data: null, error: { message: "boom" } },
        ],
      },
    });
    const bucket = client.storage.from("invoices");
    expect(await bucket.upload("p", new Uint8Array(1), { upsert: false })).toEqual({
      data: { path: "p" },
      error: null,
    });
    expect((await bucket.upload("q", new Uint8Array(1))).error?.message).toBe("boom");
    expect((await bucket.upload("r", new Uint8Array(1))).error?.message).toBe("boom");
    expect(client.storage.from).toHaveBeenCalledWith("invoices");
    expect(client.storage.upload).toHaveBeenCalledTimes(3);
  });

  it("scripts createSignedUrl and has a harmless default", async () => {
    const scripted = fakeSupabase({
      storage: { createSignedUrl: [{ data: null, error: { message: "nope" } }] },
    });
    expect((await scripted.storage.from("invoices").createSignedUrl("p", 300)).error).toEqual({
      message: "nope",
    });
    const plain = fakeSupabase();
    const result = await plain.storage.from("invoices").createSignedUrl("p", 300);
    expect(result.error).toBeNull();
    expect((result.data as { signedUrl: string }).signedUrl).toMatch(/^https:\/\//);
    expect(plain.storage.createSignedUrl).toHaveBeenCalledWith("p", 300);
  });

  it("scripts download and defaults to an empty blob", async () => {
    const bytes = new Blob([Uint8Array.from([1, 2, 3])]);
    const scripted = fakeSupabase({
      storage: {
        download: [
          { data: bytes, error: null },
          { data: null, error: { message: "gone" } },
        ],
      },
    });
    const first = await scripted.storage.from("invoices").download("a/b.pdf");
    expect((first.data as Blob).size).toBe(3);
    expect((await scripted.storage.from("invoices").download("a/b.pdf")).error).toEqual({
      message: "gone",
    });
    expect(scripted.storage.download).toHaveBeenCalledWith("a/b.pdf");

    const plain = fakeSupabase();
    const result = await plain.storage.from("invoices").download("p");
    expect(result.error).toBeNull();
    expect(result.data).toBeInstanceOf(Blob);
  });
});
