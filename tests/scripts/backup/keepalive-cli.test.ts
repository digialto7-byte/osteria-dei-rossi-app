import { describe, expect, it } from "vitest";
import { runKeepalive } from "../../../scripts/backup/keepalive";

const KEY = "test-publishable-key";

function setup(status: number, env: Record<string, string | undefined> = {}) {
  const calls: string[] = [];
  const lines: string[] = [];
  return {
    calls,
    lines,
    deps: {
      env: { SUPABASE_URL: "https://abc.supabase.co", SUPABASE_PUBLISHABLE_KEY: KEY, ...env },
      fetch: (async (url: string | URL) => {
        calls.push(String(url));
        return new Response("{}", { status });
      }) as typeof fetch,
      log: (line: string) => void lines.push(line),
    },
  };
}

describe("runKeepalive", () => {
  it("pings /auth/v1/health once and exits 0", async () => {
    const { deps, calls, lines } = setup(200);
    expect(await runKeepalive(deps)).toBe(0);
    expect(calls).toEqual(["https://abc.supabase.co/auth/v1/health"]);
    expect(lines.join("\n")).not.toContain(KEY);
  });

  it("exits 1 with the code on a 503, never with the key or the host", async () => {
    const { deps, lines } = setup(503);
    expect(await runKeepalive(deps)).toBe(1);
    expect(lines.join("\n")).toContain("keepalive_failed:503");
    expect(lines.join("\n")).not.toContain(KEY);
    expect(lines.join("\n")).not.toContain("abc.supabase.co");
  });

  it("exits 1 naming the missing variables, without any request", async () => {
    const { deps, calls, lines } = setup(200, { SUPABASE_PUBLISHABLE_KEY: undefined });
    expect(await runKeepalive(deps)).toBe(1);
    expect(calls).toEqual([]);
    expect(lines.join("\n")).toContain("backup_env_missing:SUPABASE_PUBLISHABLE_KEY");
  });
});
