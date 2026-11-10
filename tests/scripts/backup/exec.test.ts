import { afterEach, describe, expect, it, vi } from "vitest";
import { spawnRunner } from "../../../scripts/lib/backup/exec";

afterEach(() => vi.unstubAllEnvs());

describe("spawnRunner", () => {
  it("does not pass SUPABASE_SECRET_KEY to the child, and keeps the rest of the environment", () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "test-key-secret");
    vi.stubEnv("BACKUP_TEST_KEEP", "kept");
    const result = spawnRunner(process.execPath, [
      "-e",
      "process.stdout.write(JSON.stringify({ key: process.env.SUPABASE_SECRET_KEY ?? null, keep: process.env.BACKUP_TEST_KEEP ?? null, path: Boolean(process.env.PATH) }))",
    ]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ key: null, keep: "kept", path: true });
  });

  it("leaves the parent's own environment untouched", () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "test-key-secret");
    spawnRunner(process.execPath, ["-e", ""]);
    expect(process.env.SUPABASE_SECRET_KEY).toBe("test-key-secret");
  });

  it("still passes stdin input and returns stdout", () => {
    const result = spawnRunner(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], {
      input: "pass",
    });
    expect(result).toEqual({ status: 0, stdout: "pass", stderr: "" });
  });
});
