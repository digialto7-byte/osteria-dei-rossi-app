import { describe, expect, it } from "vitest";
import {
  barSend,
  chunkFireIds,
  fireGroups,
  sendAriaLabel,
  sendLabel,
  sendSegueLabel,
  skippedMessage,
  unsentGroups,
  voidReasonLabel,
  voidReasonOptions,
} from "@/lib/orders/fire-view";
import { VOID_REASONS } from "@/server/orders/constants";
import type { OrderLine } from "@/server/orders/output";
import { LINE_STEW } from "../../helpers/orders-data";

const L = (id: string, extra: Partial<OrderLine> = {}): OrderLine => ({
  ...LINE_STEW,
  id,
  ...extra,
});
const A = "20000000-0000-4000-8000-00000000000a";
const B = "20000000-0000-4000-8000-00000000000b";
const C = "20000000-0000-4000-8000-00000000000c";
const D = "20000000-0000-4000-8000-00000000000d";
const E = "20000000-0000-4000-8000-00000000000e";
const F = "20000000-0000-4000-8000-00000000000f";
const G = "20000000-0000-4000-8000-000000000010";

const byCourse = (groups: ReturnType<typeof fireGroups>, course: string) =>
  groups.find((g) => g.course === course);

describe("fireGroups", () => {
  const lines = [
    L(A, { course: "primi", segue: false }),
    L(B, { course: "primi", segue: false }),
    L(C, { course: "primi", segue: true }),
    L(D, { course: "secondi", segue: false }),
    L(E, { course: "secondi", state: "fired" }),
    L(F, { course: "secondi", state: "voided" }),
    L(G, { course: "dolci", state: "fired" }),
  ];

  it("splits the confirmed drafts of each course into the normal and the segue ids, found by id", () => {
    const groups = fireGroups(lines);
    const primi = byCourse(groups, "primi")!;
    expect([...primi.normalIds].sort()).toEqual([A, B]);
    expect(primi.segueIds).toEqual([C]);
    expect(primi.blocked).toBe(false);
    const secondi = byCourse(groups, "secondi")!;
    expect(secondi.normalIds).toEqual([D]);
    expect(secondi.segueIds).toEqual([]);
  });

  it("leaves out fired and voided lines, and a course with no draft", () => {
    const groups = fireGroups(lines);
    expect(groups.flatMap((g) => [...g.normalIds, ...g.segueIds])).not.toContain(E);
    expect(groups.flatMap((g) => [...g.normalIds, ...g.segueIds])).not.toContain(F);
    expect(byCourse(groups, "dolci")).toBeUndefined();
  });

  it("lists the courses in service order", () => {
    expect(fireGroups(lines).map((g) => g.course)).toEqual(["primi", "secondi"]);
  });

  it("blocks a course while one of its lines is unconfirmed, and never sends that line", () => {
    const groups = fireGroups(lines, [B]);
    const primi = byCourse(groups, "primi")!;
    expect(primi.blocked).toBe(true);
    expect(primi.normalIds).toEqual([A]);
    expect(byCourse(groups, "secondi")!.blocked).toBe(false);
  });

  it("a course whose only draft is unconfirmed still shows (blocked, nothing to send)", () => {
    const primi = byCourse(fireGroups([L(A, { course: "primi" })], [A]), "primi")!;
    expect(primi.blocked).toBe(true);
    expect(primi.normalIds).toEqual([]);
  });

  it("no lines, no groups", () => {
    expect(fireGroups([])).toEqual([]);
  });
});

describe("labels", () => {
  it("sendLabel and sendSegueLabel", () => {
    expect(sendLabel("primi", 2)).toBe("Invia primi · 2");
    expect(sendLabel("antipasti", 1)).toBe("Invia antipasti · 1");
    expect(sendSegueLabel(1)).toBe("Invia a seguire · 1");
  });

  it("the accessible names say what is sent, with the right plural", () => {
    expect(sendAriaLabel("primi", 2, false)).toBe("Invia in cucina: Primi, 2 piatti");
    expect(sendAriaLabel("primi", 1, true)).toBe("Invia in cucina: Primi a seguire, 1 piatto");
  });

  it("English", () => {
    expect(sendLabel("primi", 2, "en")).toBe("Send first courses · 2");
    expect(sendSegueLabel(1, "en")).toBe("Send follow-ups · 1");
  });
});

describe("skippedMessage", () => {
  it("is null when nothing was skipped", () => {
    expect(skippedMessage([])).toBeNull();
  });

  it("says how many dishes were already in the kitchen or voided", () => {
    expect(skippedMessage([{ lineId: A, reason: "already_fired" }])).toBe(
      "1 piatto era già in cucina",
    );
    expect(skippedMessage([{ lineId: A, reason: "voided" }])).toBe("1 piatto era stornato");
    expect(
      skippedMessage([
        { lineId: A, reason: "already_fired" },
        { lineId: B, reason: "already_fired" },
      ]),
    ).toBe("2 piatti erano già in cucina");
    expect(
      skippedMessage([
        { lineId: A, reason: "already_fired" },
        { lineId: B, reason: "voided" },
        { lineId: C, reason: "voided" },
      ]),
    ).toBe("1 piatto era già in cucina. 2 piatti erano stornati");
  });
});

describe("void reasons", () => {
  it("has a label for each reason, in the order of VOID_REASONS", () => {
    expect(voidReasonOptions().map((o) => o.value)).toEqual([...VOID_REASONS]);
    expect(voidReasonOptions().map((o) => o.label)).toEqual([
      "Errore di comanda",
      "Il cliente ha cambiato idea",
      "Errore in cucina",
      "Rimandato indietro",
      "Offerto dalla casa",
      "Caduto o rotto",
    ]);
  });

  it("voidReasonLabel", () => {
    expect(voidReasonLabel("kitchen_error")).toBe("Errore in cucina");
    expect(voidReasonLabel("kitchen_error", "en")).toBe("Kitchen error");
  });
});

describe("chunkFireIds (review fix: the server takes 1-50 ids per call)", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);

  it("keeps up to 50 ids in one call", () => {
    expect(chunkFireIds(ids(1))).toEqual([ids(1)]);
    expect(chunkFireIds(ids(50))).toEqual([ids(50)]);
  });

  it("splits 51 into 50 + 1 and 120 into 50 + 50 + 20, in order, with nothing lost or repeated", () => {
    const chunks51 = chunkFireIds(ids(51));
    expect(chunks51.map((c) => c.length)).toEqual([50, 1]);
    const chunks120 = chunkFireIds(ids(120));
    expect(chunks120.map((c) => c.length)).toEqual([50, 50, 20]);
    expect(chunks120.flat()).toEqual(ids(120));
  });

  it("no ids, no calls", () => {
    expect(chunkFireIds([])).toEqual([]);
  });

  it("takes another size", () => {
    expect(chunkFireIds(ids(5), 2).map((c) => c.length)).toEqual([2, 2, 1]);
  });
});

// QW12 (docs/plans/2026-11-13-ux-quick-wins.md): the leave sheet sends exactly what each course's "Invia" button sends.
describe("unsentGroups", () => {
  const lines = [
    L(A, { course: "secondi" }),
    L(B, { course: "antipasti" }),
    L(C, { course: "antipasti", queue: "add" } as Partial<OrderLine>),
    L(D, { course: "primi", segue: true }),
    L(E, { course: "primi", queue: "fire" } as Partial<OrderLine>),
    L(F, { course: "dolci", state: "fired" }),
    L(G, { course: "bevande", state: "voided" }),
  ];

  it("gives the ids per course, in service order, as the Invia buttons would send them", () => {
    expect(unsentGroups(lines)).toEqual([
      { course: "antipasti", ids: [B, C] },
      { course: "secondi", ids: [A] },
    ]);
  });

  it("equals the normalIds of the sheet's send groups for the same lines", () => {
    const sheet = fireGroups(lines.filter((l) => !("queue" in l && l.queue === "fire")))
      .filter((g) => g.normalIds.length > 0)
      .map((g) => ({ course: g.course, ids: g.normalIds }));
    expect(unsentGroups(lines)).toEqual(sheet);
  });

  it("leaves out segue, queued-fire, queued-void, fired and voided lines; nothing unsent gives []", () => {
    expect(
      unsentGroups([
        L(D, { segue: true }),
        L(E, { queue: "fire" } as Partial<OrderLine>),
        L(F, { queue: "void" } as Partial<OrderLine>),
        L(G, { state: "fired" }),
      ]),
    ).toEqual([]);
    expect(unsentGroups([])).toEqual([]);
  });
});

describe("barSend (W1, W-b)", () => {
  const lines = [
    L(A, { course: "secondi" }),
    L(B, { course: "antipasti" }),
    L(C, { course: "antipasti", queue: "add" } as Partial<OrderLine>),
    L(D, { course: "primi", segue: true }),
    L(E, { course: "primi", queue: "fire" } as Partial<OrderLine>),
    L(F, { course: "dolci", state: "fired" }),
    L(G, { course: "bevande", queue: "void" } as Partial<OrderLine>),
  ];

  it("(a) the selected course with drafts wins, with that course's normalIds", () => {
    const sheet = fireGroups(lines.filter((l) => !("queue" in l && l.queue === "fire")));
    expect(barSend(lines, "secondi")).toEqual({
      course: "secondi",
      ids: byCourse(sheet, "secondi")!.normalIds,
    });
  });

  it("(b) a selected course with no drafts falls to the first course in service order that has them", () => {
    expect(barSend(lines, "dolci")).toEqual({ course: "antipasti", ids: [B, C] });
  });

  it("(c) a selected course with only segue drafts falls through", () => {
    expect(barSend(lines, "primi")).toEqual({ course: "antipasti", ids: [B, C] });
  });

  it("(d) a queued add counts; a queued fire and a queued void do not", () => {
    expect(barSend(lines, "antipasti")?.ids).toEqual([B, C]);
    expect(barSend([L(E, { queue: "fire" } as Partial<OrderLine>)], "primi")).toBeNull();
    expect(barSend([L(G, { queue: "void" } as Partial<OrderLine>)], "bevande")).toBeNull();
  });

  it("(e) only segue drafts, or none, give null", () => {
    expect(barSend([L(D, { segue: true })], "primi")).toBeNull();
    expect(barSend([], "primi")).toBeNull();
  });

  it("(f) the ids equal unsentGroups' ids for the returned course", () => {
    for (const selected of ["antipasti", "primi", "secondi", "dolci", "bevande"] as const) {
      const sent = barSend(lines, selected)!;
      expect(sent.ids).toEqual(unsentGroups(lines).find((g) => g.course === sent.course)!.ids);
    }
  });
});
