import { describe, expect, it } from "vitest";
import { ModelError, StockModel, bucketKey, toTicks, type ModelLot } from "./stock-model";

const CELLA = "cella";
const FREEZER = "freezer";
const BEEF = "beef";

const lot = (
  id: string,
  expiry: string | null,
  receivedOn = "2026-10-20",
  ingredient = BEEF,
): ModelLot => ({
  id,
  ingredient,
  expiry,
  receivedOn,
});

// The AT1 fixture: 2 kg each of L-D5, L-D2 and a lot without an expiry, at Cella, received the same day.
function at1(): StockModel {
  const model = new StockModel();
  model.receive(lot("l-d5", "2026-10-28"), CELLA, toTicks(2));
  model.receive(lot("l-d2", "2026-10-25"), CELLA, toTicks(2));
  model.receive(lot("l-none", null), CELLA, toTicks(2));
  return model;
}
const lots = (rows: { lot: string | null; ticks: number }[]) =>
  rows.map((row) => `${row.lot ?? "null"}:${row.ticks / 10_000}`);

describe("StockModel: FEFO (AT1)", () => {
  it("takes the first-expiring lot, then the next, then the lot without an expiry", () => {
    const rows = at1().outflow("op1", BEEF, CELLA, toTicks(5));
    expect(lots(rows)).toEqual(["l-d2:-2", "l-d5:-2", "l-none:-1"]);
  });

  it("takes only what is needed from the first lot", () => {
    expect(lots(at1().outflow("op1", BEEF, CELLA, toTicks(1)))).toEqual(["l-d2:-1"]);
  });

  it("breaks an expiry tie by the earlier received_on, then by the lot id", () => {
    const model = new StockModel();
    model.receive(lot("l-t2", "2026-10-26", "2026-10-22"), CELLA, toTicks(1));
    model.receive(lot("l-t1", "2026-10-26", "2026-10-20"), CELLA, toTicks(1));
    expect(lots(model.outflow("op1", BEEF, CELLA, toTicks(1)))).toEqual(["l-t1:-1"]);
    const same = new StockModel();
    same.receive(lot("b", "2026-10-26"), CELLA, toTicks(1));
    same.receive(lot("a", "2026-10-26"), CELLA, toTicks(1));
    expect(lots(same.outflow("op1", BEEF, CELLA, toTicks(1)))).toEqual(["a:-1"]);
  });

  it("ignores lots whose stock is at another location", () => {
    const model = new StockModel();
    model.receive(lot("l-fz", "2026-10-24"), FREEZER, toTicks(2));
    model.receive(lot("l-ce", "2026-10-30"), CELLA, toTicks(2));
    expect(lots(model.outflow("op1", BEEF, CELLA, toTicks(1)))).toEqual(["l-ce:-1"]);
  });
});

describe("StockModel: override lot", () => {
  it("takes the override lot first, then continues in FEFO order", () => {
    expect(lots(at1().outflow("op1", BEEF, CELLA, toTicks(1), "l-none"))).toEqual(["l-none:-1"]);
    expect(lots(at1().outflow("op1", BEEF, CELLA, toTicks(3), "l-none"))).toEqual([
      "l-none:-2",
      "l-d2:-1",
    ]);
  });

  it("refuses an empty override lot and a lot of another ingredient", () => {
    const model = at1();
    model.outflow("op1", BEEF, CELLA, toTicks(2), "l-d5");
    expect(() => model.outflow("op2", BEEF, CELLA, toTicks(1), "l-d5")).toThrowError(
      expect.objectContaining({ code: "lot_empty" }),
    );
    model.receive(lot("l-flour", null, "2026-10-20", "flour"), CELLA, toTicks(1));
    expect(() => model.outflow("op3", BEEF, CELLA, toTicks(1), "l-flour")).toThrowError(ModelError);
    expect(() => model.outflow("op4", BEEF, CELLA, toTicks(1), "nope")).toThrowError(
      expect.objectContaining({ code: "lot_not_found" }),
    );
  });
});

describe("StockModel: shortfall", () => {
  it("books the missing part on the unlotted bucket and never drives a lot below zero", () => {
    const model = new StockModel();
    model.receive(lot("l-s", "2026-10-25"), CELLA, toTicks(2));
    expect(lots(model.outflow("op1", BEEF, CELLA, toTicks(3)))).toEqual(["l-s:-2", "null:-1"]);
    expect(model.bucket(BEEF, CELLA, "l-s")).toBe(0);
    expect(model.bucket(BEEF, CELLA, null)).toBe(-10_000);
    expect(model.total(BEEF, CELLA)).toBe(-10_000);
  });

  it("an outflow on an empty location is one unlotted row", () => {
    expect(lots(new StockModel().outflow("op1", BEEF, CELLA, toTicks(1.5)))).toEqual(["null:-1.5"]);
  });
});

describe("StockModel: transfers (AT4)", () => {
  it("moves a lot between locations and keeps the ingredient total", () => {
    const model = new StockModel();
    model.receive(lot("l-d2", "2026-10-25"), CELLA, toTicks(2));
    const rows = model.transfer("t1", BEEF, CELLA, FREEZER, toTicks(1.5));
    expect(rows.map((row) => `${row.location}:${row.lot}:${row.ticks / 10_000}`)).toEqual([
      "cella:l-d2:-1.5",
      "freezer:l-d2:1.5",
    ]);
    expect(model.total(BEEF, CELLA)).toBe(toTicks(0.5));
    expect(model.total(BEEF, FREEZER)).toBe(toTicks(1.5));
    expect(model.total(BEEF, CELLA) + model.total(BEEF, FREEZER)).toBe(toTicks(2));
  });

  it("follows FEFO over several lots, and an override lot moves first", () => {
    const model = at1();
    expect(
      lots(
        model.transfer("t1", BEEF, CELLA, FREEZER, toTicks(5)).filter((r) => r.location === CELLA),
      ),
    ).toEqual(["l-d2:-2", "l-d5:-2", "l-none:-1"]);
    const other = at1();
    expect(
      lots(
        other
          .transfer("t1", BEEF, CELLA, FREEZER, toTicks(3), "l-none")
          .filter((r) => r.location === CELLA),
      ),
    ).toEqual(["l-none:-2", "l-d2:-1"]);
  });

  it("refuses more than is recorded and books nothing", () => {
    const model = at1();
    const before = model.rows.length;
    expect(() => model.transfer("t1", BEEF, CELLA, FREEZER, toTicks(7))).toThrowError(
      expect.objectContaining({ code: "insufficient_stock" }),
    );
    expect(model.rows.length).toBe(before);
  });

  it("counts a negative unlotted bucket against the move (location total, not only positive lots)", () => {
    const model = new StockModel();
    model.receive(lot("l-p1", "2026-11-30"), CELLA, toTicks(2));
    model.outflow("w1", BEEF, CELLA, toTicks(3)); // l-p1 to 0, unlotted -1
    model.receive(lot("l-p2", "2026-12-30"), CELLA, toTicks(2)); // the location holds 1
    const before = model.rows.length;
    expect(() => model.transfer("t1", BEEF, CELLA, FREEZER, toTicks(2))).toThrowError(
      expect.objectContaining({ code: "insufficient_stock" }),
    );
    expect(model.rows.length).toBe(before);
    model.transfer("t2", BEEF, CELLA, FREEZER, toTicks(1));
    expect(model.total(BEEF, CELLA)).toBe(0);
  });

  it("refuses to move back out more than a location with a shortfall holds", () => {
    const model = new StockModel();
    model.receive(lot("l-q1", "2026-11-30"), CELLA, toTicks(2));
    model.outflow("w1", BEEF, FREEZER, toTicks(1)); // Freezer: unlotted -1
    model.transfer("in", BEEF, CELLA, FREEZER, toTicks(2)); // Freezer: l-q1 2, unlotted -1
    expect(model.total(BEEF, FREEZER)).toBe(toTicks(1));
    expect(() => model.transfer("out", BEEF, FREEZER, CELLA, toTicks(2))).toThrowError(
      expect.objectContaining({ code: "insufficient_stock" }),
    );
    model.transfer("out2", BEEF, FREEZER, CELLA, toTicks(1));
    expect(model.total(BEEF, FREEZER)).toBe(0);
  });

  it("refuses the same location, and a shortfall bucket is not stock", () => {
    const model = new StockModel();
    model.receive(lot("l-s", "2026-10-25"), CELLA, toTicks(1));
    model.outflow("op1", BEEF, CELLA, toTicks(2));
    expect(() => model.transfer("t1", BEEF, CELLA, CELLA, toTicks(1))).toThrowError(
      expect.objectContaining({ code: "same_location" }),
    );
    expect(() => model.transfer("t2", BEEF, CELLA, FREEZER, toTicks(1))).toThrowError(
      expect.objectContaining({ code: "insufficient_stock" }),
    );
  });
});

describe("StockModel: reversals (AT5)", () => {
  it("restores every bucket, leaves the original rows alone and mirrors each row", () => {
    const model = new StockModel();
    model.receive(lot("l-s", "2026-10-25"), CELLA, toTicks(2));
    const before = new Map(model.buckets());
    const original = model.outflow("w1", BEEF, CELLA, toTicks(3));
    const snapshot = JSON.stringify(original);
    const mirrors = model.reverse("r1", "w1");
    expect(mirrors.map((row) => [row.lot, row.ticks, row.reverses])).toEqual(
      original.map((row) => [row.lot, -row.ticks, row.index]),
    );
    expect(model.buckets()).toEqual(before);
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it("an operation is reversed once; a reversal is not reversed; a receipt is not reversible", () => {
    const model = at1();
    model.outflow("w1", BEEF, CELLA, toTicks(1));
    model.reverse("r1", "w1");
    expect(() => model.reverse("r2", "w1")).toThrowError(
      expect.objectContaining({ code: "already_reversed" }),
    );
    expect(() => model.reverse("r3", "r1")).toThrowError(
      expect.objectContaining({ code: "movement_is_reversal" }),
    );
    expect(() => model.reverse("r4", "receipt-l-d2")).toThrowError(
      expect.objectContaining({ code: "movement_not_reversible" }),
    );
  });

  it("reverses a transfer leg by leg, unless the destination was used", () => {
    const model = new StockModel();
    model.receive(lot("l-d2", "2026-10-25"), CELLA, toTicks(2));
    model.transfer("t1", BEEF, CELLA, FREEZER, toTicks(2));
    model.outflow("w1", BEEF, FREEZER, toTicks(1.5));
    expect(() => model.reverse("r1", "t1")).toThrowError(
      expect.objectContaining({ code: "transfer_already_used" }),
    );
    model.reverse("r2", "w1");
    model.reverse("r3", "t1");
    expect(model.buckets()).toEqual(new Map([[bucketKey(BEEF, CELLA, "l-d2"), toTicks(2)]]));
  });

  it("a reversed shortfall leaves no unlotted balance and a reversed outflow can leave a positive unlotted bucket last in FEFO", () => {
    const model = new StockModel();
    model.receive(lot("l-s", "2026-10-25"), CELLA, toTicks(1));
    model.outflow("w1", BEEF, CELLA, toTicks(2)); // lot -1, unlotted -1
    model.receive(lot("l-new", "2026-10-30", "2026-10-22"), CELLA, toTicks(1));
    model.reverse("r1", "w1"); // lot +1, unlotted +1: a positive unlotted bucket
    expect(model.bucket(BEEF, CELLA, null)).toBe(0);
    const next = model.outflow("w2", BEEF, CELLA, toTicks(2));
    expect(lots(next)).toEqual(["l-s:-1", "l-new:-1"]);
  });

  it("buckets() lists non-empty buckets only, and totals() sums per location", () => {
    const model = at1();
    model.outflow("w1", BEEF, CELLA, toTicks(2));
    expect([...model.buckets().keys()].sort()).toEqual([
      bucketKey(BEEF, CELLA, "l-d5"),
      bucketKey(BEEF, CELLA, "l-none"),
    ]);
    expect(model.totals().get(`${BEEF}|${CELLA}`)).toBe(toTicks(4));
    expect(model.reversibleOperations()).toEqual(["w1"]);
  });
});
