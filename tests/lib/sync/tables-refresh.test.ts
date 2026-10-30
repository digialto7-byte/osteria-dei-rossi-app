import { describe, expect, it } from "vitest";
import { tablesChanged, type SettledEvent } from "@/lib/sync/tables-refresh";

const ev = (
  kind: SettledEvent["kind"],
  status: SettledEvent["status"],
  extra = {},
): SettledEvent => ({
  kind,
  status,
  ...extra,
});

describe("tablesChanged", () => {
  it("an applied open_table changes the list", () => {
    expect(tablesChanged([ev("open_table", "applied")])).toBe(true);
  });

  it("a duplicate of an open_table the server had taken counts; a duplicate of a refusal does not", () => {
    expect(tablesChanged([ev("open_table", "duplicate")])).toBe(true);
    expect(
      tablesChanged([
        ev("open_table", "duplicate", { conflict: { reason: "table_already_open" } }),
      ]),
    ).toBe(false);
    expect(tablesChanged([ev("open_table", "duplicate", { error: { code: "x" } })])).toBe(false);
  });

  it("a conflict, a refusal or a drop of an open_table changed nothing", () => {
    for (const status of ["conflict", "rejected", "dropped"] as const) {
      expect(tablesChanged([ev("open_table", status)]), status).toBe(false);
    }
  });

  it("edits, adds, removals, fires and voids never do, whatever their status", () => {
    for (const kind of ["add_line", "edit_line", "remove_line", "fire", "void_line"] as const) {
      for (const status of ["applied", "duplicate", "conflict", "rejected"] as const) {
        expect(tablesChanged([ev(kind, status)]), `${kind} ${status}`).toBe(false);
      }
    }
  });

  it("one open among other operations is enough, and nothing settled is false", () => {
    expect(
      tablesChanged([
        ev("add_line", "applied"),
        ev("open_table", "applied"),
        ev("fire", "applied"),
      ]),
    ).toBe(true);
    expect(tablesChanged([])).toBe(false);
  });
});
