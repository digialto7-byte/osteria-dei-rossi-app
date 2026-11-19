import { describe, expect, it } from "vitest";
import { downShape } from "@/server/sync/apply";
import { SYNC_KINDS, SYNC_VERSION_HEADER, syncVersionOf } from "@/server/sync/constants";
import { opResult, syncOutput } from "@/server/sync/output";
import { syncOutputV1 } from "@/server/sync/output-v1";
import { toOpResult } from "@/server/sync/results";
import { PAYLOADS } from "@/server/sync/schemas";
import { ADD_REPLY, LINE_STEW, OIDS } from "../../helpers/orders-data";

// Comanda per uscita, step 10 (docs/plans/2026-11-18-comanda-uscite.md §3.12): the sync side. A reply stored before the deploy has no
// uscita and no held: it is upgraded before the strict parse (nothing invented). An old bundle (no X-Sync-Version) gets today's v1 shape.
const OP = "0e000000-0000-4000-8000-000000000001";
const AT = "2026-11-02T19:31:00.123456+00:00";
const dup = (result: unknown, status = "applied") => ({
  opId: OP,
  status: "duplicate",
  stop: false,
  stored: { status, receivedAt: AT, result },
});
const fresh = (result: unknown, status = "applied") => ({
  opId: OP,
  status,
  receivedAt: AT,
  stop: false,
  result,
});
// The exact pre-deploy line shape: no uscita key.
const { uscita: _u, ...PRE_DEPLOY_LINE } = LINE_STEW;
const CALL = {
  changed: true,
  call: { uscita: 2, calledAt: AT, calledBy: { id: OIDS.waiterA, displayName: "Cameriere Demo" } },
  lines: [{ ...LINE_STEW, uscita: 2, segue: true, state: "fired" }],
};

describe("stored replies from before the deploy", () => {
  it("a duplicate whose stored add_line reply is the exact pre-deploy line shape (no uscita) parses with uscita: null", () => {
    const { result } = toOpResult("add_line", dup({ ...ADD_REPLY, line: PRE_DEPLOY_LINE }));
    expect(result.status).toBe("duplicate");
    if (result.status !== "duplicate" || result.stored.status !== "applied")
      throw new Error("shape");
    expect(result.stored.reply).toMatchObject({ line: { uscita: null } });
  });

  it("a stored fire reply without held gains held: []", () => {
    const { result } = toOpResult(
      "fire",
      dup({ lines: [PRE_DEPLOY_LINE], fired: [LINE_STEW.id], skipped: [] }),
    );
    if (result.status !== "duplicate" || result.stored.status !== "applied")
      throw new Error("shape");
    expect(result.stored.reply).toMatchObject({ held: [], lines: [{ uscita: null }] });
  });

  it("a stored conflict line without uscita gains uscita: null", () => {
    const { result } = toOpResult(
      "edit_line",
      dup({ conflict: { reason: "stale", line: PRE_DEPLOY_LINE } }, "conflict"),
    );
    if (result.status !== "duplicate" || result.stored.status !== "conflict")
      throw new Error("shape");
    expect(result.stored.conflict.line?.uscita).toBeNull();
  });

  it("everything else stays strict: an unknown key still throws", () => {
    expect(() =>
      toOpResult("add_line", dup({ ...ADD_REPLY, line: { ...PRE_DEPLOY_LINE, unitCost: 1 } })),
    ).toThrow();
    expect(() =>
      toOpResult("fire", dup({ lines: [], fired: [], skipped: [], held: [], extra: 1 })),
    ).toThrow();
  });
});

describe("the call kind", () => {
  it("call_uscita is the seventh kind, last", () => {
    expect(SYNC_KINDS.at(-1)).toBe("call_uscita");
    expect(SYNC_KINDS).toHaveLength(7);
  });

  it("its payload is {sessionId, uscita} strict", () => {
    expect(PAYLOADS.call_uscita.safeParse({ sessionId: OIDS.session, uscita: 2 }).success).toBe(
      true,
    );
    expect(PAYLOADS.call_uscita.safeParse({ sessionId: OIDS.session, uscita: 1 }).success).toBe(
      false,
    );
    expect(
      PAYLOADS.call_uscita.safeParse({ sessionId: OIDS.session, uscita: 2, hold: true }).success,
    ).toBe(false);
    expect(PAYLOADS.call_uscita.safeParse({ uscita: 2 }).success).toBe(false);
  });

  it("add, edit and fire payloads take uscita / hold", () => {
    const base = { sessionId: OIDS.session, lineId: OIDS.line1, menuItemId: OIDS.item };
    expect(PAYLOADS.add_line.safeParse({ ...base, uscita: 2 }).success).toBe(true);
    expect(PAYLOADS.add_line.safeParse({ ...base, uscita: 2, segue: true }).success).toBe(false);
    expect(PAYLOADS.edit_line.safeParse({ lineId: OIDS.line1, uscita: 0 }).success).toBe(true);
    expect(
      PAYLOADS.edit_line.safeParse({ lineId: OIDS.line1, uscita: 3, segue: true }).success,
    ).toBe(false);
    expect(
      PAYLOADS.fire.safeParse({ sessionId: OIDS.session, lineIds: [OIDS.line1], hold: true })
        .success,
    ).toBe(true);
  });

  it("an applied call parses, and a call conflict is a conflict with the uscita", () => {
    expect(toOpResult("call_uscita", fresh(CALL)).result).toMatchObject({
      status: "applied",
      reply: { changed: true },
    });
    const { result } = toOpResult(
      "call_uscita",
      fresh({ conflict: { reason: "already_called", uscita: 2, calledAt: AT } }, "conflict"),
    );
    expect(result).toMatchObject({
      status: "conflict",
      conflict: { reason: "already_called", uscita: 2, calledAt: AT },
    });
    expect(opResult.safeParse(result).success).toBe(true);
  });
});

describe("versions", () => {
  it("no header is version 1, '2' is version 2, anything else is refused", () => {
    expect(SYNC_VERSION_HEADER).toBe("x-sync-version");
    expect(syncVersionOf(null)).toBe(1);
    expect(syncVersionOf("2")).toBe(2);
    expect(syncVersionOf("1")).toBe(1);
    expect(syncVersionOf("3")).toBeNull();
    expect(syncVersionOf("two")).toBeNull();
  });

  const v2 = syncOutput.parse({
    results: [
      toOpResult("add_line", fresh(ADD_REPLY)).result,
      toOpResult(
        "fire",
        fresh({ lines: [LINE_STEW], fired: [LINE_STEW.id], skipped: [], held: [LINE_STEW.id] }),
      ).result,
      toOpResult("void_line", fresh({ conflict: { reason: "held", line: LINE_STEW } }, "conflict"))
        .result,
      toOpResult(
        "void_line",
        fresh({ conflict: { reason: "uscita_called", line: LINE_STEW } }, "conflict"),
      ).result,
    ],
    stopped: null,
    serverTime: AT,
  });

  it("a v1 request gets lines without uscita and a fire reply without held, and passes the v1 schema frozen from main", () => {
    const v1 = downShape(v2);
    expect(syncOutputV1.safeParse(v1).success).toBe(true);
    expect(JSON.stringify(v1)).not.toContain("uscita");
    expect(JSON.stringify(v1)).not.toContain('"held"');
  });

  it("a held or uscita_called conflict reaches v1 as stale", () => {
    const v1 = downShape(v2);
    const reasons = v1.results.flatMap((r: (typeof v1.results)[number]) =>
      r.status === "conflict" ? [r.conflict.reason] : [],
    );
    expect(reasons).toEqual(["stale", "stale"]);
  });

  it("the v2 shape is the full one and does not pass v1", () => {
    expect(syncOutputV1.safeParse(v2).success).toBe(false);
    expect(JSON.stringify(v2)).toContain("uscita");
  });
});
