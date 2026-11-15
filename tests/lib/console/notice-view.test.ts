import { describe, expect, it } from "vitest";
import { noticeSentence, notifiedLine, splitNotices } from "@/lib/console/notice-view";

const tenant = (n: number) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  name: `Locale ${n}`,
});

describe("noticeSentence", () => {
  it("says how many venues are not yet notified", () => {
    expect(
      noticeSentence({ kind: "subprocessor", version: 3, pending: [tenant(1), tenant(2)] }),
    ).toBe("Nuovo sub-responsabile v3: 2 locali non ancora avvisati");
  });
  it("uses the singular for one", () => {
    expect(noticeSentence({ kind: "subprocessor", version: 3, pending: [tenant(1)] })).toBe(
      "Nuovo sub-responsabile v3: 1 locale non ancora avvisato",
    );
  });
  it("says all are notified when none is pending", () => {
    expect(noticeSentence({ kind: "subprocessor", version: 3, pending: [] })).toBe(
      "Nuovo sub-responsabile v3: tutti i locali avvisati",
    );
  });
  it("is null for an unknown kind", () => {
    expect(noticeSentence({ kind: "other", version: 1, pending: [] })).toBeNull();
  });
});

describe("splitNotices", () => {
  it("puts a notice with nothing pending under read, keeping the order", () => {
    const a = { id: "a", pending: [tenant(1)] };
    const b = { id: "b", pending: [] };
    const c = { id: "c", pending: [tenant(2)] };
    const d = { id: "d", pending: [] };
    expect(splitNotices([a, b, c, d])).toEqual({ unread: [a, c], read: [b, d] });
  });
});

describe("notifiedLine", () => {
  it("shows the instant in Europe/Rome", () => {
    expect(notifiedLine("2026-11-14T08:40:00Z")).toBe("Avvisato il 14 nov 2026, 09:40");
  });
});
