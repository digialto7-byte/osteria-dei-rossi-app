import { describe, expect, it } from "vitest";
import { noticesFor, overwrittenNotices } from "@/lib/sync/notices";
import type { OutcomeRecord } from "@/lib/sync/types";
import { LINE_STEW, OIDS } from "../../helpers/orders-data";
import { DEMO, DUE, lineId, opId, STEW, SYNC_IDS } from "../../helpers/sync-data";

// The words for what the server decided, in Italian and English (M20 plan §3.6.5 table, step 15). Found by op id, never by position.
const outcome = (n: number, extra: Partial<OutcomeRecord>): OutcomeRecord => ({
  opId: opId(n),
  seq: n,
  kind: "edit_line",
  userId: DEMO.id,
  scope: { sessionId: SYNC_IDS.s1, lineId: lineId(n) },
  label: { tableName: "Tavolo 3 (demo)", dishName: STEW, qty: 2 },
  clientTs: "2026-11-02T19:30:00.000Z",
  status: "conflict",
  settledAt: 1_000,
  seen: false,
  ...extra,
});
const find = (notices: ReturnType<typeof noticesFor>, n: number) =>
  notices.find((notice) => notice.opIds.includes(opId(n)));

const LINE_NOW = { ...LINE_STEW, updatedAt: "2026-11-02T19:31:00.000Z" };

describe("noticesFor: conflicts", () => {
  it("stale: the dish and who changed the line and when (Europe/Rome)", () => {
    const stale = outcome(1, {
      conflict: {
        reason: "stale",
        line: { ...LINE_NOW, updatedBy: { id: DUE.id, displayName: DUE.displayName } },
      },
    });
    const notice = find(noticesFor([stale]), 1)!;
    expect(notice.kind).toBe("conflict");
    expect(notice.sessionId).toBe(SYNC_IDS.s1);
    expect(notice.text).toBe(
      "«Spezzatino con polenta (demo)»: Questa riga è stata cambiata da Cameriere Due Demo alle 20:31: ecco la versione attuale.",
    );
  });

  it("fired: the dish was already in the kitchen and the change was not applied", () => {
    const fired = outcome(2, { conflict: { reason: "fired", line: LINE_NOW } });
    expect(find(noticesFor([fired]), 2)!.text).toBe(
      "«Spezzatino con polenta (demo)» era già in cucina: la tua modifica non è stata applicata.",
    );
  });

  it("voided and session_closed reuse the M18 and M19 words with the dish", () => {
    const voided = outcome(3, { conflict: { reason: "voided", line: LINE_NOW } });
    const closed = outcome(4, { conflict: { reason: "session_closed" } });
    const notices = noticesFor([voided, closed]);
    expect(find(notices, 3)!.text).toBe(
      "«Spezzatino con polenta (demo)»: Questa riga è stata tolta.",
    );
    expect(find(notices, 4)!.text).toBe(
      "«Spezzatino con polenta (demo)»: Il tavolo è stato chiuso.",
    );
  });

  it("a table that was already open lists the dishes that were not registered, from the dropped ops of that session", () => {
    const open = outcome(5, {
      kind: "open_table",
      scope: { sessionId: SYNC_IDS.s2 },
      label: { tableName: "Tavolo 3 (demo)" },
      conflict: { reason: "table_already_open", sessionId: SYNC_IDS.s1 },
    });
    const dropped = (n: number, qty: number, dish: string) =>
      outcome(n, {
        kind: "add_line",
        status: "dropped",
        droppedReason: "session_not_created",
        scope: { sessionId: SYNC_IDS.s2, lineId: lineId(n) },
        label: { tableName: "Tavolo 3 (demo)", dishName: dish, qty },
      });
    const notices = noticesFor([open, dropped(6, 2, STEW), dropped(7, 1, "Acqua (demo)")]);
    expect(notices).toHaveLength(1);
    expect(notices[0]!.text).toBe(
      "Tavolo 3 (demo) era già aperto da un collega. Questi piatti non sono stati registrati: 2 × Spezzatino con polenta (demo), Acqua (demo). Inseriscili sul tavolo aperto.",
    );
    expect([...notices[0]!.opIds].sort()).toEqual([opId(5), opId(6), opId(7)].sort());
  });

  it("a table that was already open with nothing queued behind it says only that", () => {
    const open = outcome(5, {
      kind: "open_table",
      scope: { sessionId: SYNC_IDS.s2 },
      label: { tableName: "Tavolo 3 (demo)" },
      conflict: { reason: "table_already_open" },
    });
    expect(noticesFor([open])[0]!.text).toBe("Tavolo 3 (demo) era già aperto da un collega.");
  });
});

describe("noticesFor: rejected", () => {
  it("sold out: the dish and that it was not registered", () => {
    const sold = outcome(1, {
      kind: "add_line",
      status: "rejected",
      error: { httpStatus: 409, code: "item_unavailable", message: "Il piatto è esaurito." },
    });
    expect(find(noticesFor([sold]), 1)!.text).toBe(
      "«Spezzatino con polenta (demo)» è esaurito: non è stato registrato.",
    );
  });

  it("any other code: the mapped Italian message and the dish", () => {
    const other = outcome(2, {
      kind: "void_line",
      status: "rejected",
      error: { httpStatus: 422, code: "void_reason_invalid", message: "Scegli un motivo valido." },
    });
    expect(find(noticesFor([other]), 2)!.text).toBe(
      "«Spezzatino con polenta (demo)»: Scegli un motivo valido.",
    );
  });

  it("with no dish it names the table", () => {
    const fire = outcome(3, {
      kind: "fire",
      status: "rejected",
      scope: { sessionId: SYNC_IDS.s1 },
      label: { tableName: "Tavolo 3 (demo)" },
      error: { httpStatus: 404, code: "not_found", message: "Riga non trovata." },
    });
    expect(find(noticesFor([fire]), 3)!.text).toBe("Tavolo 3 (demo): Riga non trovata.");
  });

  it("a code nobody knows still reads well", () => {
    const unknown = outcome(4, {
      status: "rejected",
      error: {
        httpStatus: 422,
        code: "rejected_unknown",
        message: "L'operazione non è stata accettata dal server.",
      },
    });
    expect(find(noticesFor([unknown]), 4)!.text).toBe(
      "«Spezzatino con polenta (demo)»: L'operazione non è stata accettata dal server.",
    );
  });

  it("a duplicate of a rejected op is noticed like the rejection", () => {
    const dup = outcome(5, {
      kind: "add_line",
      status: "duplicate",
      error: { httpStatus: 409, code: "item_unavailable", message: "Il piatto è esaurito." },
    });
    expect(find(noticesFor([dup]), 5)!.text).toContain("è esaurito");
  });
});

describe("noticesFor: dropped, applied, seen", () => {
  it("dropped: not sent, the dish was not registered", () => {
    const dropped = outcome(1, { status: "dropped", droppedReason: "line_not_created" });
    expect(find(noticesFor([dropped]), 1)!.text).toBe(
      "Non inviato: «Spezzatino con polenta (demo)» non era stato registrato.",
    );
  });

  it("dropped without a dish names the table", () => {
    const dropped = outcome(2, {
      kind: "fire",
      status: "dropped",
      droppedReason: "line_not_created",
      label: { tableName: "Tavolo 3 (demo)" },
    });
    expect(find(noticesFor([dropped]), 2)!.text).toBe(
      "Non inviato: un'operazione su Tavolo 3 (demo) non era più possibile.",
    );
  });

  it("applied outcomes and seen ones make no notice", () => {
    const applied = outcome(1, { status: "applied", conflict: undefined });
    const seen = outcome(2, { conflict: { reason: "fired" }, seen: true });
    expect(noticesFor([applied, seen])).toEqual([]);
  });

  it("filters by session when asked, and keeps every session otherwise", () => {
    const one = outcome(1, { conflict: { reason: "fired" } });
    const two = outcome(2, {
      conflict: { reason: "fired" },
      scope: { sessionId: SYNC_IDS.s2, lineId: lineId(2) },
    });
    expect(noticesFor([one, two], { sessionId: SYNC_IDS.s2 }).map((n) => n.opIds[0])).toEqual([
      opId(2),
    ]);
    expect(noticesFor([one, two])).toHaveLength(2);
  });

  it("English", () => {
    const fired = outcome(1, { conflict: { reason: "fired" } });
    const sold = outcome(2, {
      kind: "add_line",
      status: "rejected",
      error: { httpStatus: 409, code: "item_unavailable", message: "Il piatto è esaurito." },
    });
    const dropped = outcome(3, { status: "dropped", droppedReason: "line_not_created" });
    const notices = noticesFor([fired, sold, dropped], { locale: "en" });
    expect(find(notices, 1)!.text).toBe(
      "“Spezzatino con polenta (demo)” was already in the kitchen: your change was not applied.",
    );
    expect(find(notices, 2)!.text).toBe(
      "“Spezzatino con polenta (demo)” is sold out: it was not recorded.",
    );
    expect(find(notices, 3)!.text).toBe(
      "Not sent: “Spezzatino con polenta (demo)” had not been recorded.",
    );
  });

  it("no text contains a euro sign, 'Costo' or 'Margine'", () => {
    const all = [
      outcome(1, { conflict: { reason: "stale", line: LINE_NOW } }),
      outcome(2, { conflict: { reason: "fired" } }),
      outcome(3, {
        status: "rejected",
        error: { httpStatus: 409, code: "item_unavailable", message: "x" },
      }),
      outcome(4, { status: "dropped", droppedReason: "line_not_created" }),
    ];
    for (const locale of ["it", "en"] as const) {
      for (const notice of noticesFor(all, { locale })) {
        expect(notice.text).not.toMatch(/€|Costo|Margine|Cost|Margin/);
      }
    }
  });

  it("a script in a dish name stays text (the component escapes it); the notice never builds markup", () => {
    const evil = outcome(1, {
      conflict: { reason: "fired" },
      label: { dishName: "<script>x</script>" },
    });
    expect(noticesFor([evil])[0]!.text).toContain("<script>x</script>");
  });
});

describe("overwrittenNotices (AT5, second order)", () => {
  const mine = outcome(1, {
    kind: "edit_line",
    status: "applied",
    userId: DEMO.id,
    scope: { sessionId: SYNC_IDS.s1, lineId: OIDS.line1 },
    clientTs: "2026-11-02T19:30:00.000Z",
  });
  const lines = [
    {
      ...LINE_STEW,
      clientUpdatedAt: "2026-11-02T19:30:30.000Z",
      updatedAt: "2026-11-02T19:31:00.000Z",
      updatedBy: { id: DUE.id, displayName: DUE.displayName },
    },
  ];

  it("flags a line whose stamp is later than my applied one and whose updater is someone else", () => {
    const notices = overwrittenNotices([mine], lines, { id: DEMO.id });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      kind: "overwritten",
      sessionId: SYNC_IDS.s1,
      opIds: [opId(1)],
      text: "Cameriere Due Demo ha cambiato «Spezzatino con polenta (demo)» dopo di te, alle 20:31.",
    });
  });

  it("does not flag it when the updater is me", () => {
    const own = [{ ...lines[0]!, updatedBy: { id: DEMO.id, displayName: DEMO.displayName } }];
    expect(overwrittenNotices([mine], own, { id: DEMO.id })).toEqual([]);
  });

  it("does not flag a line with an earlier or equal stamp", () => {
    const older = [{ ...lines[0]!, clientUpdatedAt: "2026-11-02T19:29:00.000Z" }];
    const same = [{ ...lines[0]!, clientUpdatedAt: mine.clientTs }];
    expect(overwrittenNotices([mine], older, { id: DEMO.id })).toEqual([]);
    expect(overwrittenNotices([mine], same, { id: DEMO.id })).toEqual([]);
  });

  it("ignores other people's outcomes, conflicts, adds and seen ones", () => {
    const theirs = outcome(2, { ...mine, opId: opId(2), userId: DUE.id });
    const conflict = outcome(3, { ...mine, opId: opId(3), status: "conflict" });
    const add = outcome(4, { ...mine, opId: opId(4), kind: "add_line" });
    const seen = outcome(5, { ...mine, opId: opId(5), seen: true });
    expect(overwrittenNotices([theirs, conflict, add, seen], lines, { id: DEMO.id })).toEqual([]);
  });

  it("one notice per line even if I edited it twice, and English works", () => {
    const again = outcome(6, { ...mine, opId: opId(6), clientTs: "2026-11-02T19:30:10.000Z" });
    const notices = overwrittenNotices([mine, again], lines, { id: DEMO.id }, "en");
    expect(notices).toHaveLength(1);
    expect(notices[0]!.opIds.sort()).toEqual([opId(1), opId(6)].sort());
    expect(notices[0]!.text).toBe(
      "Cameriere Due Demo changed “Spezzatino con polenta (demo)” after you, at 20:31.",
    );
  });

  it("a line that is no longer on the view makes no notice", () => {
    expect(overwrittenNotices([mine], [], { id: DEMO.id })).toEqual([]);
  });
});
