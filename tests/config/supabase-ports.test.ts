import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

/** A PATH with the tools the script needs (bash, awk, sort, tr, sed, sleep, node) but without ss, so the description must come from /proc alone. */
function noSsPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "no-ss-"));
  for (const tool of ["bash", "awk", "sort", "tr", "sed", "sleep", "mktemp", "kill", "cat"]) {
    const found = spawnSync("bash", ["-c", `command -v ${tool}`], {
      encoding: "utf8",
    }).stdout.trim();
    if (found.startsWith("/")) symlinkSync(found, join(dir, tool));
  }
  symlinkSync(process.execPath, join(dir, "node"));
  return dir;
}

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
function run(args: string[], port: number, holdMs?: number, extra: Record<string, string> = {}) {
  const env = {
    NODE_ENV: "test" as const,
    PATH: process.env.PATH ?? "",
    SUPABASE_PORT_FIRST: String(port),
    SUPABASE_PORT_LAST: String(port),
    NODE: process.execPath,
    SCRIPT,
    HOLD_MS: String(holdMs ?? 0),
    PORT: String(port),
    ...extra,
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
  it("guards 54320-54329 by default; moving the ephemeral range is each job's first step, not the script's", () => {
    expect(script).toContain(`FIRST="\${SUPABASE_PORT_FIRST:-${FIRST}}"`);
    expect(script).toContain(`LAST="\${SUPABASE_PORT_LAST:-${LAST}}"`);
    expect(script).not.toContain("sysctl");
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

  it("on the timeout it describes the socket that holds the port, without needing ss (T1 spike, run 43656779665 printed nothing)", () => {
    const port = freePort();
    const result = run(["wait-free", "2"], port, 10_000, { PATH: noSsPath() });
    expect(result.stderr).toContain("supabase-ports: the sockets that hold them:");
    expect(result.stderr).toContain(
      `  port ${port}: LISTEN, local 127.0.0.1, remote 0.0.0.0:0, uid ${process.getuid!()},`,
    );
    expect(result.status).toBe(1);
  });

  it("wait-free succeeds once the port is released within the timeout", () => {
    const result = run(["wait-free", "10"], freePort(), 1_500);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("reads a timeout with a leading zero as decimal (08 is 8 seconds, not an octal error)", () => {
    const result = run(["wait-free", "08"], freePort());
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("fails, and never reports the ports free, when it cannot read the IPv4 socket table", () => {
    const result = run(["wait-free", "5"], freePort(), undefined, {
      SUPABASE_PROC_NET: "/nonexistent/proc-net",
    });
    expect(result.stderr).toContain("supabase-ports: cannot read /nonexistent/proc-net/tcp");
    expect(result.status).toBe(1);
  });

  it("refuses an unknown mode, the removed reserve mode and a non-numeric timeout", () => {
    const port = freePort();
    expect(run(["nope"], port).status).toBe(2);
    expect(run(["reserve"], port).status).toBe(2);
    expect(run(["wait-free", "soon"], port).status).toBe(2);
  });
});
