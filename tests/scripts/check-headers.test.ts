import { describe, expect, it } from "vitest";
import { runCheckHeaders } from "../../scripts/check-headers";
import { buildCsp } from "@/lib/security/csp";
import { ORIGINAL_PATH, SANDBOX_CSP } from "@/lib/security/header-check";

// The AT2 script (M25 step 3), with fetch and the clock-free outputs faked: no network.
const SECRET = "bypass-not-a-secret";
const ORIGIN = "https://abc.supabase.co";
const csp = (nonce: string | null) =>
  buildCsp({ supabaseOrigin: ORIGIN, deployment: "production", dev: false, nonce });

type Call = { url: string; init: RequestInit | undefined };

function fake(options: { csp?: Record<string, string>; sameNonce?: boolean } = {}) {
  const calls: Call[] = [];
  let login = 0;
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    calls.push({ url: String(url), init });
    let policy: string;
    if (path === "/login") {
      login += 1;
      const nonce = Buffer.alloc(16, options.sameNonce ? 7 : login).toString("base64");
      policy = options.csp?.[path] ?? csp(nonce);
    } else if (path === ORIGINAL_PATH) {
      policy = options.csp?.[path] ?? SANDBOX_CSP;
    } else {
      policy = options.csp?.[path] ?? csp(null);
    }
    return new Response("body", {
      status: 200,
      headers: {
        "x-content-type-options": "nosniff",
        "referrer-policy": "strict-origin-when-cross-origin",
        "x-frame-options": "DENY",
        "strict-transport-security": "max-age=63072000; includeSubDomains",
        "content-security-policy": policy,
      },
    });
  }) as typeof fetch;
  return { fetchFn, calls };
}

async function run(args: string[], env: Record<string, string | undefined>, f = fake()) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCheckHeaders(
    args,
    env,
    f.fetchFn,
    (t) => out.push(t),
    (t) => err.push(t),
  );
  return { code, out, err, calls: f.calls };
}

describe("check-headers script", () => {
  it("refuses http://example.com with exit 1 before any fetch", async () => {
    const r = await run(["--base-url", "http://example.com", "--expect", "production"], {});
    expect(r.code).toBe(1);
    expect(r.calls).toEqual([]);
  });

  it("allows localhost over http", async () => {
    const r = await run(["--base-url", "http://localhost:3000", "--expect", "local"], {});
    expect(r.calls.length).toBeGreaterThan(0);
  });

  it("fetches /login twice, /api/health, /sw.js and the original once, with redirect: manual", async () => {
    const r = await run(["--base-url", "https://app.example.test", "--expect", "production"], {});
    expect(r.calls.map((c) => new URL(c.url).pathname)).toEqual([
      "/login",
      "/login",
      "/api/health",
      "/sw.js",
      ORIGINAL_PATH,
    ]);
    for (const call of r.calls) expect(call.init?.redirect).toBe("manual");
  });

  it("a static policy on the original makes it exit 1, naming the path", async () => {
    const r = await run(
      ["--base-url", "https://app.example.test", "--expect", "production"],
      {},
      fake({ csp: { [ORIGINAL_PATH]: csp(null) } }),
    );
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out[0]!).findings).toEqual([
      { path: ORIGINAL_PATH, header: "content-security-policy", problem: "csp_not_sandbox" },
    ]);
  });

  it("two policies on the original make it exit 1", async () => {
    const r = await run(
      ["--base-url", "https://app.example.test", "--expect", "production"],
      {},
      fake({ csp: { [ORIGINAL_PATH]: `${SANDBOX_CSP}, ${csp(null)}` } }),
    );
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out[0]!).findings).toEqual([
      { path: ORIGINAL_PATH, header: "content-security-policy", problem: "multiple_csp" },
    ]);
  });

  it("sends x-vercel-protection-bypass only when the secret is set and not blank", async () => {
    const args = ["--base-url", "https://app.example.test", "--expect", "preview"];
    const set = await run(args, { VERCEL_AUTOMATION_BYPASS_SECRET: SECRET });
    for (const call of set.calls) {
      expect(new Headers(call.init?.headers).get("x-vercel-protection-bypass")).toBe(SECRET);
    }
    for (const env of [
      {},
      { VERCEL_AUTOMATION_BYPASS_SECRET: "" },
      { VERCEL_AUTOMATION_BYPASS_SECRET: "  " },
    ]) {
      const none = await run(args, env);
      for (const call of none.calls) {
        expect(new Headers(call.init?.headers).has("x-vercel-protection-bypass")).toBe(false);
      }
    }
  });

  it("prints one JSON line with names and findings only: no secret, no nonce, no header value", async () => {
    const f = fake({ sameNonce: true });
    const r = await run(
      ["--base-url", "https://app.example.test", "--expect", "production"],
      {
        VERCEL_AUTOMATION_BYPASS_SECRET: SECRET,
      },
      f,
    );
    const all = [...r.out, ...r.err].join("\n");
    expect(r.out).toHaveLength(1);
    expect(() => JSON.parse(r.out[0]!)).not.toThrow();
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain(Buffer.alloc(16, 7).toString("base64"));
    expect(all).not.toContain("nonce-");
    expect(all).not.toContain("max-age");
  });

  it("exits 1 on findings and 0 with only notes", async () => {
    const bad = await run(
      ["--base-url", "https://app.example.test", "--expect", "production"],
      {},
      fake({ sameNonce: true }),
    );
    expect(bad.code).toBe(1);
    expect(JSON.parse(bad.out[0]!).findings.length).toBeGreaterThan(0);
    const good = await run(
      ["--base-url", "https://app.example.test", "--expect", "production"],
      {},
    );
    expect(good.code).toBe(0);
    expect(JSON.parse(good.out[0]!)).toMatchObject({
      findings: [],
      notes: ["style-src unsafe-inline (ADR-028)"],
    });
  });

  it("rejects a bad --expect or a missing --base-url with exit 1", async () => {
    expect((await run(["--base-url", "https://a.test", "--expect", "nope"], {})).code).toBe(1);
    expect((await run(["--expect", "local"], {})).code).toBe(1);
  });
});
