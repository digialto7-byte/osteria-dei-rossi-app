import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Backup self-test run 43619384683 (main, 848c3a78) failed in the FIRST `supabase start`: "failed to bind host port
// 0.0.0.0:54324/tcp: address already in use". The local stack's ports (54320-54329) sit inside Linux's default ephemeral
// range (32768-60999), so any outbound connection on the runner (image pulls, npm) can hold one of them for a moment.
// scripts/ci/supabase-ports.sh moves the ephemeral range above the stack's ports and waits, with a bounded timeout and a clear
// error, until no socket uses them. The lead requires the backup self-test to be deterministic (a go-live gate).
const SCRIPT = new URL("../../scripts/ci/supabase-ports.sh", import.meta.url).pathname;
const script = readFileSync(SCRIPT, "utf8");
const config = readFileSync(new URL("../../supabase/config.toml", import.meta.url), "utf8");

const FIRST = 54320;
const LAST = 54329;

/** A port that was free a moment ago: the kernel picks it, then the probe exits. */
function freePort(): number {
  const probe = spawnSync(
    process.execPath,
    [
      "-e",
      "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})",
    ],
    { encoding: "utf8" },
  );
  const port = Number(probe.stdout.trim());
  if (!Number.isInteger(port) || port <= 0) throw new Error(`no free port: ${probe.stderr}`);
  return port;
}

/**
 * Runs `supabase-ports.sh <args>` against one port. With holdMs, a background node process listens on that port first and
 * releases it after holdMs, so the script starts while the port is busy.
 */
function run(args: string[], port: number, holdMs?: number) {
  const env = {
    NODE_ENV: "test" as const,
    PATH: process.env.PATH ?? "",
    SUPABASE_PORT_FIRST: String(port),
    SUPABASE_PORT_LAST: String(port),
    NODE: process.execPath,
    SCRIPT,
    HOLD_MS: String(holdMs ?? 0),
    PORT: String(port),
  };
  const hold =
    holdMs === undefined
      ? ""
      : `"$NODE" -e "const s=require('net').createServer().listen(+process.env.PORT,'127.0.0.1',()=>console.log('up'));setTimeout(()=>s.close(),+process.env.HOLD_MS)" > "$READY" &
holder=$!
until [ -s "$READY" ]; do sleep 0.05; done
`;
  const body = `set -u
READY="$(mktemp)"
${hold}status=0
bash "$SCRIPT" ${args.map((a) => `'${a}'`).join(" ")} || status=$?
${holdMs === undefined ? "" : 'kill "$holder" 2>/dev/null; wait "$holder" 2>/dev/null\n'}exit "$status"`;
  return spawnSync("bash", ["-c", body], { encoding: "utf8", env, timeout: 30_000 });
}

describe("supabase/config.toml ports", () => {
  it("every host port of the local stack is inside the range the script guards", () => {
    const ports = [...config.matchAll(/^\s*(?:port|shadow_port)\s*=\s*(\d+)\s*$/gm)].map((m) =>
      Number(m[1]),
    );
    expect(ports.length).toBeGreaterThanOrEqual(7);
    for (const port of ports) {
      expect(port, String(port)).toBeGreaterThanOrEqual(FIRST);
      expect(port, String(port)).toBeLessThanOrEqual(LAST);
    }
  });
});

describe("scripts/ci/supabase-ports.sh", () => {
  it("guards 54320-54329 by default and moves the ephemeral range to start above them", () => {
    expect(script).toContain(`FIRST="\${SUPABASE_PORT_FIRST:-${FIRST}}"`);
    expect(script).toContain(`LAST="\${SUPABASE_PORT_LAST:-${LAST}}"`);
    expect(script).toContain('sudo sysctl -w net.ipv4.ip_local_port_range="55000 60999"');
    expect(script).toMatch(/^set -euo pipefail$/m);
  });

  it("wait-free exits 0 at once when no socket uses the range", () => {
    const result = run(["wait-free", "5"], freePort());
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("wait-free fails after the timeout and names the busy port when a socket keeps it", () => {
    const port = freePort();
    const result = run(["wait-free", "2"], port, 10_000);
    expect(result.stderr).toContain(`ports still in use after 2s: ${port}`);
    expect(result.status).toBe(1);
  });

  it("wait-free succeeds once the port is released within the timeout", () => {
    const result = run(["wait-free", "10"], freePort(), 1_500);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("refuses an unknown mode and a non-numeric timeout", () => {
    const port = freePort();
    expect(run(["nope"], port).status).toBe(2);
    expect(run(["wait-free", "soon"], port).status).toBe(2);
  });
});
