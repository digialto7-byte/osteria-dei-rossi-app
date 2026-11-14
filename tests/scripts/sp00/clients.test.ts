import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AdminClient } from "../../../scripts/lib/create-tenant";
import {
  apikeyOnlyFetch,
  createAdminClient,
  createUserClient,
  preflight,
  readSpikeEnv,
} from "../../../scripts/lib/sp00/clients";

const PLACEHOLDER = "placeholder-not-a-key";
const PUBLISHABLE = "test-publishable-key";
const URL_ = "http://127.0.0.1:54321";
const ENV = {
  SPIKE_SUPABASE_URL: URL_,
  SPIKE_PUBLISHABLE_KEY: PUBLISHABLE,
  SPIKE_SECRET_KEY: PLACEHOLDER,
};

interface Seen {
  url: string;
  headers: Headers;
}

function recorder(status = 200, body: unknown = { users: [], aud: "authenticated" }) {
  const seen: Seen[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    seen.push({ url: request.url, headers: request.headers });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { seen, fetchImpl };
}

describe("readSpikeEnv", () => {
  it("reads the three variables and accepts a placeholder without checking its form", () => {
    expect(readSpikeEnv(ENV)).toEqual({
      supabaseUrl: URL_,
      publishableKey: PUBLISHABLE,
      secretKey: PLACEHOLDER,
    });
    expect(readSpikeEnv({ ...ENV, SPIKE_SECRET_KEY: "x" }).secretKey).toBe("x");
  });

  it.each(["SPIKE_SUPABASE_URL", "SPIKE_PUBLISHABLE_KEY", "SPIKE_SECRET_KEY"])(
    "names %s, and no value, when it is missing or empty",
    (name) => {
      for (const value of [undefined, ""]) {
        const message = (() => {
          try {
            readSpikeEnv({ ...ENV, [name]: value });
          } catch (error) {
            return String(error);
          }
          return "";
        })();
        expect(message).toContain(name);
        expect(message).not.toContain(PLACEHOLDER);
        expect(message).not.toContain(PUBLISHABLE);
      }
    },
  );
});

describe("the admin client", () => {
  it("sends the placeholder on apikey only and no Authorization header", async () => {
    const { seen, fetchImpl } = recorder();
    const admin = createAdminClient(readSpikeEnv(ENV), fetchImpl);
    await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
    await admin.from("tenant").select("id");
    await admin.rpc("create_tenant_with_owner", {});
    expect(seen.length).toBeGreaterThanOrEqual(3);
    for (const call of seen) {
      expect(call.headers.get("apikey")).toBe(PLACEHOLDER);
      expect(call.headers.has("authorization")).toBe(false);
    }
  });

  it("satisfies createTenant's AdminClient interface", () => {
    const admin: AdminClient = createAdminClient(readSpikeEnv(ENV), recorder().fetchImpl);
    expect(typeof admin.rpc).toBe("function");
  });
});

describe("apikeyOnlyFetch", () => {
  it("removes only an Authorization header that is Bearer <the secret>", async () => {
    const { seen, fetchImpl } = recorder();
    const wrapped = apikeyOnlyFetch(fetchImpl, PLACEHOLDER);
    await wrapped(`${URL_}/a`, {
      headers: { apikey: PLACEHOLDER, Authorization: `Bearer ${PLACEHOLDER}` },
    });
    await wrapped(`${URL_}/b`, {
      headers: { apikey: PLACEHOLDER, Authorization: "Bearer some-user-token" },
    });
    expect(seen[0]?.headers.has("authorization")).toBe(false);
    expect(seen[0]?.headers.get("apikey")).toBe(PLACEHOLDER);
    expect(seen[1]?.headers.get("authorization")).toBe("Bearer some-user-token");
  });
});

describe("user clients", () => {
  it("send the publishable key on apikey and the user token as Bearer, never the placeholder", async () => {
    const { seen, fetchImpl } = recorder(200, []);
    const env = readSpikeEnv(ENV);
    const user = createUserClient(env, "user-access-token", fetchImpl);
    await user.from("tenant").select("id");
    await user.rpc("sp0_platform_ping", {});
    expect(seen.length).toBe(2);
    for (const call of seen) {
      expect(call.headers.get("apikey")).toBe(PUBLISHABLE);
      expect(call.headers.get("authorization")).toBe("Bearer user-access-token");
      expect([...call.headers.values()].join("|")).not.toContain(PLACEHOLDER);
    }
  });

  it("without a token still never carries the placeholder", async () => {
    const { seen, fetchImpl } = recorder(200, []);
    await createUserClient(readSpikeEnv(ENV), null, fetchImpl).from("tenant").select("id");
    expect([...(seen[0]?.headers.values() ?? [])].join("|")).not.toContain(PLACEHOLDER);
    expect(seen[0]?.headers.get("apikey")).toBe(PUBLISHABLE);
  });
});

describe("preflight", () => {
  const run = async (status: number, body: unknown = {}) => {
    const { seen, fetchImpl } = recorder(status, body);
    const admin = createAdminClient(readSpikeEnv(ENV), fetchImpl);
    return { result: await preflight(admin), seen };
  };

  it("200 passes and asks for one user on page one", async () => {
    const { result, seen } = await run(200, { users: [], aud: "authenticated" });
    expect(result).toEqual({ id: "preflight", result: "pass", detail: { status: 200 } });
    expect(new URL(seen[0]?.url ?? "").pathname).toBe("/auth/v1/admin/users");
    expect(new URL(seen[0]?.url ?? "").searchParams.get("per_page")).toBe("1");
  });

  it.each([401, 403])("%i is inconclusive with 'secret key not injected'", async (status) => {
    const { result } = await run(status, { msg: "nope" });
    expect(result).toEqual({
      id: "preflight",
      result: "inconclusive",
      detail: { status, reason: "secret key not injected" },
    });
    expect(JSON.stringify(result)).not.toContain(PLACEHOLDER);
  });

  it("any other status is inconclusive and says so, not a pass", async () => {
    const { result } = await run(500, { msg: "boom" });
    expect(result.result).toBe("inconclusive");
    expect(result.detail.status).toBe(500);
    expect(result.detail.reason).toBe("unexpected answer from Auth");
  });
});

describe("preflight when Auth cannot be reached", () => {
  it("is inconclusive with its own reason and no status", async () => {
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const result = await preflight(createAdminClient(readSpikeEnv(ENV), failing));
    expect(result.result).toBe("inconclusive");
    expect(result.detail.status).toBeNull();
    expect(result.detail.reason).toBe("Auth could not be reached");
  });
});

describe("source scan of the secret handling", () => {
  const dir = join(process.cwd(), "scripts/lib/sp00");
  const files = readdirSync(dir).filter((name) => name.endsWith(".ts"));
  const entries = readdirSync(join(process.cwd(), "scripts/spike"))
    .filter((name) => name.startsWith("sp00-"))
    .map((name) => join(process.cwd(), "scripts/spike", name));
  const read = (path: string) => readFileSync(path, "utf8");

  it("clients.ts exists and decodes nothing: no atob, base64, Buffer.from, JSON.parse or token splitting", () => {
    expect(files).toContain("clients.ts");
    const source = read(join(dir, "clients.ts"));
    for (const forbidden of [
      /\batob\b/,
      /base64/i,
      /Buffer\.from/,
      /JSON\.parse/,
      /split\(["']\.["']\)/,
    ]) {
      expect(source).not.toMatch(forbidden);
    }
  });

  it("SPIKE_SECRET_KEY is read only in clients.ts, and no other lib module touches the secret", () => {
    for (const name of files.filter((file) => file !== "clients.ts")) {
      const source = read(join(dir, name));
      expect(source, name).not.toContain("SPIKE_SECRET_KEY");
      expect(source, name).not.toMatch(/secretKey/);
    }
    for (const path of entries) expect(read(path)).not.toContain("SPIKE_SECRET_KEY");
  });

  it("SUPABASE_SECRET_KEY is nowhere under scripts/lib/sp00 or in the sp00 entry scripts", () => {
    for (const path of [...files.map((name) => join(dir, name)), ...entries]) {
      expect(read(path), path).not.toContain("SUPABASE_SECRET_KEY");
    }
  });
});
