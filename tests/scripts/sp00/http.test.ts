import { describe, expect, it } from "vitest";
import {
  codeOf,
  followOnce,
  logoutCall,
  restCall,
  signUpCall,
  storageDownload,
  storageList,
  storageUpload,
  totpEnrol,
  totpVerify,
  type HttpEnv,
} from "../../../scripts/lib/sp00/http";

const PUB = "test-publishable-key";
const BASE = "http://127.0.0.1:54321";

interface Seen {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
}
function server(responses: (seen: Seen) => Response) {
  const seen: Seen[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const entry: Seen = {
      url: request.url,
      method: request.method,
      headers: request.headers,
      body:
        init?.body === undefined || init.body === null
          ? null
          : Buffer.from(init.body as Uint8Array | string).toString(),
    };
    seen.push(entry);
    return responses(entry);
  }) as typeof fetch;
  const env: HttpEnv = { supabaseUrl: BASE, publishableKey: PUB, fetchImpl };
  return { env, seen };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("codeOf", () => {
  it("reads GoTrue's error_code, PostgREST's code and Storage's error, only when short strings", () => {
    expect(codeOf({ error_code: "signup_disabled", code: 422 })).toBe("signup_disabled");
    expect(codeOf({ code: "42501" })).toBe("42501");
    expect(codeOf({ statusCode: "404", error: "not_found" })).toBe("not_found");
    expect(codeOf({ error: "a long sentence with spaces" })).toBeNull();
    expect(codeOf({ code: 422 })).toBeNull();
    expect(codeOf(null)).toBeNull();
    expect(codeOf("text")).toBeNull();
  });
});

describe("restCall", () => {
  it("sends the publishable key on apikey and the user token as Bearer, to /rest/v1<path>", async () => {
    const { env, seen } = server(() => json([{ id: "t" }]));
    const answer = await restCall(env, "user-token", "POST", "/rpc/f", { a: 1 });
    expect(seen[0]?.url).toBe(`${BASE}/rest/v1/rpc/f`);
    expect(seen[0]?.headers.get("apikey")).toBe(PUB);
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer user-token");
    expect(seen[0]?.headers.get("content-type")).toBe("application/json");
    expect(seen[0]?.body).toBe('{"a":1}');
    expect(answer).toEqual({ status: 200, code: null, body: [{ id: "t" }] });
  });

  it("a GET sends no body; an empty answer has a null body; an error carries its code", async () => {
    const { env, seen } = server((s) =>
      s.url.includes("empty")
        ? new Response(null, { status: 204 })
        : json({ code: "42501", message: "denied" }, 403),
    );
    expect(await restCall(env, "t", "GET", "/empty")).toEqual({
      status: 204,
      code: null,
      body: null,
    });
    expect(seen[0]?.body).toBeNull();
    expect(await restCall(env, "t", "GET", "/tenant?select=id")).toMatchObject({
      status: 403,
      code: "42501",
    });
  });
});

describe("an answer that is not JSON", () => {
  it("keeps its status and has a null body and no code (the status says what happened)", async () => {
    const { env } = server(() => new Response("<html>Bad Gateway</html>", { status: 502 }));
    expect(await restCall(env, "t", "GET", "/tenant?select=id")).toEqual({
      status: 502,
      code: null,
      body: null,
    });
  });
});

describe("signUpCall", () => {
  it("posts to /auth/v1/signup with the publishable key only and reports the user id when an account came back", async () => {
    const { env, seen } = server(() => json({ id: "u-1", email: "x" }));
    const answer = await signUpCall(env, "a@example.test", "pw");
    expect(seen[0]?.url).toBe(`${BASE}/auth/v1/signup`);
    expect(seen[0]?.headers.get("apikey")).toBe(PUB);
    expect(seen[0]?.headers.has("authorization")).toBe(false);
    expect(answer).toEqual({ status: 200, code: null, userId: "u-1" });
  });

  it("a refusal has no user id and carries Auth's error code", async () => {
    const { env } = server(() =>
      json({ code: 422, error_code: "signup_disabled", msg: "no" }, 422),
    );
    expect(await signUpCall(env, "a@example.test", "pw")).toEqual({
      status: 422,
      code: "signup_disabled",
      userId: null,
    });
  });

  it("finds the id of a session answer's user", async () => {
    const { env } = server(() => json({ access_token: "t", user: { id: "u-2" } }));
    expect((await signUpCall(env, "a@example.test", "pw")).userId).toBe("u-2");
  });
});

describe("Storage calls", () => {
  it("upload posts a fake PDF to /storage/v1/object/invoices/<path> with the user's token", async () => {
    const { env, seen } = server(() => json({ Key: "invoices/x" }));
    expect(await storageUpload(env, "tok", "t/1998/x.pdf")).toEqual({ status: 200, code: null });
    expect(seen[0]?.url).toBe(`${BASE}/storage/v1/object/invoices/t/1998/x.pdf`);
    expect(seen[0]?.method).toBe("POST");
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer tok");
    expect(seen[0]?.headers.get("content-type")).toBe("application/pdf");
    expect(seen[0]?.body?.startsWith("%PDF-")).toBe(true);
  });

  it("list posts the folder as prefix and counts the objects", async () => {
    const { env, seen } = server(() => json([{ name: "a" }, { name: "b" }]));
    expect(await storageList(env, "tok", "t/1998")).toEqual({
      status: 200,
      code: null,
      count: 2,
      bytes: null,
    });
    expect(seen[0]?.url).toBe(`${BASE}/storage/v1/object/list/invoices`);
    expect(JSON.parse(seen[0]?.body ?? "{}")).toMatchObject({ prefix: "t/1998" });
  });

  it("list of a refused call has no count", async () => {
    const { env } = server(() =>
      json({ statusCode: "403", error: "Unauthorized", message: "x" }, 403),
    );
    expect(await storageList(env, "tok", "t/1998")).toEqual({
      status: 403,
      code: "Unauthorized",
      count: null,
      bytes: null,
    });
  });

  it("download counts the bytes of a 200 answer and gives no bytes for an error", async () => {
    const ok = server(() => new Response(new Uint8Array(12), { status: 200 }));
    expect(await storageDownload(ok.env, "tok", "t/1998/x.pdf")).toEqual({
      status: 200,
      code: null,
      count: null,
      bytes: 12,
    });
    expect(ok.seen[0]?.url).toBe(`${BASE}/storage/v1/object/authenticated/invoices/t/1998/x.pdf`);
    expect(ok.seen[0]?.method).toBe("GET");
    const denied = server(() => json({ statusCode: "404", error: "not_found" }, 400));
    expect(await storageDownload(denied.env, "tok", "t/1998/x.pdf")).toEqual({
      status: 400,
      code: "not_found",
      count: null,
      bytes: null,
    });
  });
});

describe("logoutCall", () => {
  it("posts to /auth/v1/logout with the token and returns the status", async () => {
    const { env, seen } = server(() => new Response(null, { status: 204 }));
    expect(await logoutCall(env, "tok")).toEqual({ status: 204 });
    expect(seen[0]?.url).toBe(`${BASE}/auth/v1/logout`);
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer tok");
  });
});

describe("TOTP calls", () => {
  it("enrol posts a totp factor and returns the id and the secret", async () => {
    const { env, seen } = server(() =>
      json({ id: "f-1", type: "totp", totp: { secret: "JBSWY3DPEHPK3PXP", qr_code: "x" } }),
    );
    expect(await totpEnrol(env, "tok", "sp0-name")).toEqual({
      status: 200,
      code: null,
      factorId: "f-1",
      secret: "JBSWY3DPEHPK3PXP",
    });
    expect(seen[0]?.url).toBe(`${BASE}/auth/v1/factors`);
    expect(JSON.parse(seen[0]?.body ?? "{}")).toMatchObject({
      factor_type: "totp",
      friendly_name: "sp0-name",
    });
  });

  it("enrol refused has no id or secret", async () => {
    const { env } = server(() => json({ error_code: "mfa_totp_enroll_not_enabled" }, 422));
    expect(await totpEnrol(env, "tok", "n")).toEqual({
      status: 422,
      code: "mfa_totp_enroll_not_enabled",
      factorId: null,
      secret: null,
    });
  });

  it("verify challenges, then verifies with the challenge id, and returns the new session", async () => {
    const { env, seen } = server((s) =>
      s.url.endsWith("/challenge")
        ? json({ id: "c-1" })
        : json({ access_token: "new-access", refresh_token: "new-refresh" }),
    );
    const result = await totpVerify(env, "tok", "f-1", "123456");
    expect(seen.map((s) => s.url)).toEqual([
      `${BASE}/auth/v1/factors/f-1/challenge`,
      `${BASE}/auth/v1/factors/f-1/verify`,
    ]);
    expect(JSON.parse(seen[1]?.body ?? "{}")).toEqual({ challenge_id: "c-1", code: "123456" });
    expect(result).toEqual({
      status: 200,
      code: null,
      session: { accessToken: "new-access", refreshToken: "new-refresh" },
    });
  });

  it("a refused challenge or verification returns the status and code with no session", async () => {
    const challenge = server(() => json({ error_code: "mfa_factor_not_found" }, 404));
    expect(await totpVerify(challenge.env, "tok", "f", "1")).toEqual({
      status: 404,
      code: "mfa_factor_not_found",
      session: null,
    });
    expect(challenge.seen).toHaveLength(1);
    const verify = server((s) =>
      s.url.endsWith("/challenge")
        ? json({ id: "c" })
        : json({ error_code: "mfa_verification_failed" }, 422),
    );
    expect(await totpVerify(verify.env, "tok", "f", "1")).toEqual({
      status: 422,
      code: "mfa_verification_failed",
      session: null,
    });
  });
});

describe("followOnce", () => {
  it("follows with redirect manual and returns the status and the Location header", async () => {
    const seenInit: (RequestInit | undefined)[] = [];
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seenInit.push(init);
      return new Response(null, {
        status: 302,
        headers: { location: "http://localhost:3000/?code=x" },
      });
    }) as typeof fetch;
    expect(await followOnce(fetchImpl, "http://x/verify")).toEqual({
      status: 302,
      location: "http://localhost:3000/?code=x",
    });
    expect(seenInit[0]?.redirect).toBe("manual");
  });

  it("returns a null location when there is none", async () => {
    const fetchImpl = (async () => new Response(null, { status: 200 })) as typeof fetch;
    expect(await followOnce(fetchImpl, "http://x/verify")).toEqual({ status: 200, location: null });
  });
});
