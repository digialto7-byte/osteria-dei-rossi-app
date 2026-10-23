import { describe, expect, it, vi } from "vitest";
import {
  assertLocalDbUrl,
  LOCAL_DB_URL,
  psqlArgs,
  quoteUuid,
  runSql,
  runSqlWithoutTriggers,
} from "./sql";

describe("assertLocalDbUrl", () => {
  it("accepts the local stack's default URL and localhost", () => {
    expect(() => assertLocalDbUrl(LOCAL_DB_URL)).not.toThrow();
    expect(() =>
      assertLocalDbUrl("postgresql://postgres:postgres@localhost:54322/postgres"),
    ).not.toThrow();
  });

  it.each([
    "postgresql://postgres:x@db.abcdefgh.supabase.co:5432/postgres",
    "postgresql://postgres:x@10.0.0.5:5432/postgres",
    "postgresql://postgres:x@127.0.0.1.evil.test:5432/postgres",
    "postgresql://localhost@evil.test:5432/postgres",
    "not a url",
    "",
  ])("refuses %j", (url) => {
    expect(() => assertLocalDbUrl(url)).toThrow(/local/i);
  });
});

describe("psqlArgs / runSql", () => {
  it("passes the statement as one argument, never through a shell", () => {
    const args = psqlArgs(LOCAL_DB_URL, "select 1; select 'a b'");
    expect(args).toContain("select 1; select 'a b'");
    expect(args.at(-1)).toBe(LOCAL_DB_URL);
    expect(args).toEqual(expect.arrayContaining(["-X", "ON_ERROR_STOP=1", "-A", "-t", "-c"]));
  });

  it("runs psql with an argument list and trims the output", () => {
    const run = vi.fn().mockReturnValue(" 42\n");
    expect(runSql("select 42", run)).toBe("42");
    expect(run.mock.calls[0]?.[0]).toBe("psql");
    expect(Array.isArray(run.mock.calls[0]?.[1])).toBe(true);
  });

  it("refuses a non-local URL before running anything", () => {
    const run = vi.fn();
    expect(() => runSql("select 1", run, "postgresql://u:p@prod.example.com/db")).toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it("the trigger-free variant sets session_replication_role first, in the same call", () => {
    const run = vi.fn().mockReturnValue("");
    runSqlWithoutTriggers("update t set a = 1", run);
    const statement = (run.mock.calls[0]?.[1] as string[]).find((a) => a.includes("update t"));
    expect(statement).toBe("set session_replication_role = replica; update t set a = 1");
  });
});

describe("quoteUuid", () => {
  it("quotes a uuid and refuses anything else", () => {
    expect(quoteUuid("11111111-1111-4111-8111-111111111111")).toBe(
      "'11111111-1111-4111-8111-111111111111'",
    );
    expect(() => quoteUuid("1'; drop table app_user; --")).toThrow();
  });
});
