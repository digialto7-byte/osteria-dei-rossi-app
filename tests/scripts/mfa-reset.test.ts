import { describe, expect, it, vi } from "vitest";
import { runMfaReset, type MfaAdminClient } from "../../scripts/lib/mfa-admin";

// P2-1 A13 (founder decision Q-T1 = V1): the reset of an authenticator is DigiAlto's script. begin writes the audit row first, then the factors are deleted by the
// Supabase admin API (which signs the person out everywhere), and a failure is recorded by the failed twin. Only the number of removed factors is printed.
const USER = "ae100000-0000-4000-8000-0000000000ae";
const ACTOR = "ad100000-0000-4000-8000-0000000000ad";
const AUTH = "ae000000-0000-4000-8000-0000000000ae";
const BASE = ["--user", USER, "--actor", ACTOR];
// The existing cases run the reset itself, so they skip the break-glass prompt with --yes (SP3 step 6); the prompt has its own block below.
const ARGS = [...BASE, "--yes"];
// The confirm text of plan SP3 section 3.9.3 (da approvare), word for word.
const CONFIRM_TEXT =
  "La persona verrà disconnessa da tutti i locali in cui ha un accesso (e dalla console, se è l'account DigiAlto) e al prossimo accesso dovrà attivare di nuovo il codice.";
const F1 = "f0000000-0000-4000-8000-000000000001";
const F2 = "f0000000-0000-4000-8000-000000000002";
const FAKE_KEY = "test-secret-key-do-not-print-0000";

type Err = { message: string; code?: string; details?: string | null } | null;
interface Setup {
  begin?: { data: unknown; error: Err };
  failed?: { data: unknown; error: Err };
  audit?: { data: unknown; error: Err };
  list?: { data: unknown; error: Err };
  deletes?: { data: unknown; error: Err }[];
  tty?: boolean;
  answer?: string;
}
function harness(setup: Setup = {}) {
  const begin = setup.begin ?? { data: { authId: AUTH }, error: null };
  const failed = setup.failed ?? { data: null, error: null };
  const list = setup.list ?? { data: { factors: [{ id: F1 }, { id: F2 }] }, error: null };
  const deletes = [...(setup.deletes ?? [])];
  const audit = setup.audit ?? { data: 7, error: null };
  // The platform audit writer (SP3 step 5) answers a row id.
  const rpc = vi.fn(async (fn: unknown, ..._rest: unknown[]) =>
    fn === "mfa_reset_service_begin" ? begin : fn === "platform_record_script_run" ? audit : failed,
  );
  const listFactors = vi.fn(async (..._a: unknown[]) => list);
  const deleteFactor = vi.fn(
    async (..._a: unknown[]) => deletes.shift() ?? { data: { id: "x" }, error: null },
  );
  const admin = { rpc, auth: { admin: { mfa: { listFactors, deleteFactor } } } };
  const make = vi.fn(() => admin as unknown as MfaAdminClient);
  const out: string[] = [];
  const err: string[] = [];
  const ask = vi.fn(async (_question: string) => setup.answer ?? "sì");
  return {
    ask,
    rpc,
    listFactors,
    deleteFactor,
    make,
    out,
    err,
    run: (argv: string[]) =>
      runMfaReset(argv, {
        admin: make,
        out: (l) => out.push(l),
        err: (l) => err.push(l),
        isTty: setup.tty ?? true,
        ask,
      }),
  };
}

describe("mfa-reset: the break-glass confirmation (SP3 step 6)", () => {
  it("without --yes it prints the confirmation naming every venue and the console, and stops with exit 1 when the answer is not «sì»", async () => {
    const h = harness({ answer: "no" });
    expect(await h.run(BASE)).toBe(1);
    const shown = h.err.join("\n");
    expect(shown).toContain(CONFIRM_TEXT);
    expect(shown).toContain("tutti i locali");
    expect(shown).toContain("console");
    expect(h.ask).toHaveBeenCalledTimes(1);
    expect(h.make).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.out).toEqual([]);
  });

  it.each(["", "si", "yes", "s", "sì sì"])(
    "the answer %j is not «sì»: exit 1, nothing runs",
    async (answer) => {
      const h = harness({ answer });
      expect(await h.run(BASE)).toBe(1);
      expect(h.make).not.toHaveBeenCalled();
      expect(h.rpc).not.toHaveBeenCalled();
    },
  );

  it("surrounding spaces and capitals around «sì» are accepted", async () => {
    const h = harness({ answer: " SÌ " });
    expect(await h.run(BASE)).toBe(0);
  });

  it("the answer «sì» continues with the reset", async () => {
    const h = harness({ answer: "sì" });
    expect(await h.run(BASE)).toBe(0);
    expect(h.rpc).toHaveBeenCalledWith("mfa_reset_service_begin", { p_user: USER, p_actor: ACTOR });
    expect(h.out).toEqual(['{"removed":2}']);
  });

  it("--yes skips the prompt", async () => {
    const h = harness();
    expect(await h.run([...BASE, "--yes"])).toBe(0);
    expect(h.ask).not.toHaveBeenCalled();
    expect(h.err.join("\n")).not.toContain(CONFIRM_TEXT);
  });

  it("the prompt comes before any RPC and before the admin client is made", async () => {
    const h = harness();
    await h.run(BASE);
    expect(h.ask.mock.invocationCallOrder[0]).toBeLessThan(h.make.mock.invocationCallOrder[0] ?? 0);
    expect(h.ask.mock.invocationCallOrder[0]).toBeLessThan(h.rpc.mock.invocationCallOrder[0] ?? 0);
  });

  it("a non-TTY stdin without --yes exits 2 before any call and without asking", async () => {
    const h = harness({ tty: false });
    expect(await h.run(BASE)).toBe(2);
    expect(h.ask).not.toHaveBeenCalled();
    expect(h.make).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.err.join("\n")).toContain("--yes");
  });

  it("invalid arguments still exit 2 before the prompt", async () => {
    const h = harness();
    expect(await h.run(["--user", "x", "--actor", ACTOR])).toBe(2);
    expect(h.ask).not.toHaveBeenCalled();
  });
});

describe("mfa-reset: arguments", () => {
  it.each([
    ["no arguments", []],
    ["a missing user", ["--actor", ACTOR]],
    ["a missing actor", ["--user", USER]],
    ["a user that is not a uuid", ["--user", "x", "--actor", ACTOR]],
    ["an actor that is not a uuid", ["--user", USER, "--actor", "x"]],
    ["an extra flag", [...ARGS, "--all"]],
    ["a positional argument", [...ARGS, "extra"]],
    ["the enforcement script's flags", ["--tenant", USER, "--mode", "off", "--actor", ACTOR]],
  ])("%s exits 2 before any call", async (_name, argv) => {
    const h = harness();
    expect(await h.run(argv)).toBe(2);
    expect(h.make).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.listFactors).not.toHaveBeenCalled();
    expect(h.out).toEqual([]);
  });
});

describe("mfa-reset: the reset", () => {
  it("begin, then the account's factors are listed and deleted, then the count is printed", async () => {
    const h = harness();
    expect(await h.run(ARGS)).toBe(0);
    expect(h.rpc.mock.calls.map(([fn]) => fn)).toEqual([
      "mfa_reset_service_begin",
      "platform_record_script_run",
    ]);
    expect(h.rpc).toHaveBeenCalledWith("mfa_reset_service_begin", { p_user: USER, p_actor: ACTOR });
    expect(h.listFactors).toHaveBeenCalledWith({ userId: AUTH });
    expect(h.deleteFactor).toHaveBeenCalledTimes(2);
    expect(h.deleteFactor).toHaveBeenNthCalledWith(1, { id: F1, userId: AUTH });
    expect(h.deleteFactor).toHaveBeenNthCalledWith(2, { id: F2, userId: AUTH });
    expect(h.out).toEqual(['{"removed":2}']);
    // The audit row comes before any change at Supabase (T-8).
    expect(h.rpc.mock.invocationCallOrder[0]).toBeLessThan(
      h.listFactors.mock.invocationCallOrder[0] ?? 0,
    );
    expect(h.listFactors.mock.invocationCallOrder[0]).toBeLessThan(
      h.deleteFactor.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("an account with no factor removes none and still succeeds", async () => {
    const h = harness({ list: { data: { factors: [] }, error: null } });
    expect(await h.run(ARGS)).toBe(0);
    expect(h.out).toEqual(['{"removed":0}']);
    expect(h.deleteFactor).not.toHaveBeenCalled();
  });

  it.each(["mfa_reset_target_invalid", "actor_invalid", "user_not_found"])(
    "a refusal at begin (%s) exits 1 and touches nothing at Supabase, with no failed record (nothing began)",
    async (message) => {
      const h = harness({
        begin: { data: null, error: { message, code: "P0001", details: null } },
      });
      expect(await h.run(ARGS)).toBe(1);
      expect(h.err.join("\n")).toContain(message);
      expect(h.listFactors).not.toHaveBeenCalled();
      expect(h.deleteFactor).not.toHaveBeenCalled();
      expect(h.rpc).toHaveBeenCalledTimes(1);
      expect(h.out).toEqual([]);
    },
  );

  it("a failing list records the failure through the twin, exits 1 and prints no count", async () => {
    const h = harness({
      list: { data: null, error: { message: "boom", code: "unexpected_failure" } },
    });
    expect(await h.run(ARGS)).toBe(1);
    expect(h.rpc).toHaveBeenCalledWith("mfa_reset_service_failed", {
      p_user: USER,
      p_actor: ACTOR,
    });
    expect(h.out).toEqual([]);
    expect(h.deleteFactor).not.toHaveBeenCalled();
  });

  it("a failing delete half-way records the failure, stops and exits 1", async () => {
    const h = harness({
      deletes: [
        { data: { id: F1 }, error: null },
        { data: null, error: { message: "boom", code: "unexpected_failure" } },
      ],
    });
    expect(await h.run(ARGS)).toBe(1);
    expect(h.rpc).toHaveBeenLastCalledWith("mfa_reset_service_failed", {
      p_user: USER,
      p_actor: ACTOR,
    });
    expect(h.out).toEqual([]);
    expect(h.err.join("\n")).toMatch(/1/);
  });

  it("a failing twin is reported too, and the exit is still 1", async () => {
    const h = harness({
      list: { data: null, error: { message: "boom", code: "unexpected_failure" } },
      failed: {
        data: null,
        error: { message: "mfa_reset_not_pending", code: "P0001", details: null },
      },
    });
    expect(await h.run(ARGS)).toBe(1);
    expect(h.err.join("\n")).toContain("mfa_reset_not_pending");
  });

  it("never prints a factor id, an auth id or the secret key", async () => {
    const before = process.env.SUPABASE_SECRET_KEY;
    process.env.SUPABASE_SECRET_KEY = FAKE_KEY;
    try {
      for (const setup of [
        {},
        { list: { data: null, error: { message: `boom ${FAKE_KEY}`, code: "x" } } },
      ] as Setup[]) {
        const h = harness(setup);
        await h.run(ARGS);
        const text = h.out.join("\n") + h.err.join("\n");
        for (const secret of [FAKE_KEY, F1, F2, AUTH]) expect(text).not.toContain(secret);
      }
    } finally {
      if (before === undefined) delete process.env.SUPABASE_SECRET_KEY;
      else process.env.SUPABASE_SECRET_KEY = before;
    }
  });
});

describe("mfa-reset: the platform audit (SP3 step 5)", () => {
  const auditCalls = (h: ReturnType<typeof harness>) =>
    h.rpc.mock.calls.filter(([fn]) => fn === "platform_record_script_run");

  it("writes exactly one platform audit row after a successful reset, with the app_user id and no tenant argument (the database resolves the tenant from the app_user)", async () => {
    const h = harness();
    expect(await h.run(ARGS)).toBe(0);
    expect(auditCalls(h)).toEqual([
      [
        "platform_record_script_run",
        { p_action: "script.mfa_reset", p_tenant: null, p_detail: { appUserId: USER } },
      ],
    ]);
  });

  it("writes none when the begin is refused, when listing fails or when a deletion fails", async () => {
    const refused = harness({
      begin: { data: null, error: { message: "actor_invalid", code: "P0001" } },
    });
    expect(await refused.run(ARGS)).toBe(1);
    expect(auditCalls(refused)).toEqual([]);
    const listFails = harness({ list: { data: null, error: { message: "x", code: "e1" } } });
    expect(await listFails.run(ARGS)).toBe(1);
    expect(auditCalls(listFails)).toEqual([]);
    const deleteFails = harness({ deletes: [{ data: null, error: { message: "x", code: "e2" } }] });
    expect(await deleteFails.run(ARGS)).toBe(1);
    expect(auditCalls(deleteFails)).toEqual([]);
  });

  it("writes none when the confirmation is declined", async () => {
    const h = harness({ answer: "no" });
    expect(await h.run(BASE)).toBe(1);
    expect(auditCalls(h)).toEqual([]);
  });

  it("a failing audit write exits 1 with «audit not written», says the reset was done, and prints no address or id", async () => {
    const h = harness({
      audit: { data: null, error: { message: "boom owner@example.test", code: "23514" } },
    });
    expect(await h.run(ARGS)).toBe(1);
    const shown = [...h.err, ...h.out].join("\n");
    expect(shown).toContain("audit not written");
    expect(shown).toContain("23514");
    expect(shown).not.toContain("@");
    for (const id of [USER, ACTOR, AUTH, F1, F2]) expect(shown).not.toContain(id);
    expect(h.deleteFactor).toHaveBeenCalledTimes(2);
  });
});

describe("mfa-reset: ids must be lowercase uuids (an uppercase id would reset the person and then fail the audit write)", () => {
  it.each([
    ["an uppercase --user", ["--user", USER.toUpperCase(), "--actor", ACTOR, "--yes"]],
    ["an uppercase --actor", ["--user", USER, "--actor", ACTOR.toUpperCase(), "--yes"]],
    [
      "a mixed-case --user",
      ["--user", `${USER.slice(0, 20)}${USER.slice(20).toUpperCase()}`, "--actor", ACTOR, "--yes"],
    ],
  ])(
    "%s exits 2 with the usage error before any call, without echoing the id",
    async (_label, argv) => {
      const h = harness();
      expect(await h.run(argv)).toBe(2);
      expect(h.make).not.toHaveBeenCalled();
      expect(h.rpc).not.toHaveBeenCalled();
      expect(h.listFactors).not.toHaveBeenCalled();
      expect(h.deleteFactor).not.toHaveBeenCalled();
      expect(h.ask).not.toHaveBeenCalled();
      const shown = h.err.join("\n");
      expect(shown).toMatch(/Argomenti non validi/);
      for (const part of [USER, ACTOR]) expect(shown.toLowerCase()).not.toContain(part);
    },
  );
});
