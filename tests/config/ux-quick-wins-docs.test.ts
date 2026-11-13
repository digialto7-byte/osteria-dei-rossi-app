import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// UX quick wins plan §5 (docs/plans/2026-11-13-ux-quick-wins.md): the strategy's §9.3 P1 table carries a "Done" column, a QW12 row,
// and a note that G2 is not in P1. Each build step extends SHIPPED by its id in the same commit; a shipped id whose row does not say
// `Done` fails here.
const STRATEGY = readFileSync(
  new URL("../../docs/plans/2026-11-13-ux-strategy.md", import.meta.url),
  "utf8",
);

/** Steps already built. Extended by each QW commit (PR 1: QW1, QW2; PR 2 follows). */
const SHIPPED: string[] = ["QW1", "QW2", "QW5", "QW6", "QW12", "QW3", "QW7", "QW4", "QW8"];

/** The cells of one markdown table row, trimmed. Cells never contain a bare `|` (code spans escape it as `\|`). */
function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());
}

/** The P1 table of §9.3: header cells and body rows. */
function p1Table(): { header: string[]; rows: string[][] } {
  const start = STRATEGY.indexOf("### 9.3 Build steps");
  const from = STRATEGY.indexOf("**P1 Quick wins**", start);
  const to = STRATEGY.indexOf("**P2 Design system", from);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(from).toBeGreaterThan(start);
  expect(to).toBeGreaterThan(from);
  const lines = STRATEGY.slice(from, to)
    .split("\n")
    .filter((l) => l.trim().startsWith("|"));
  const [header = "", , ...body] = lines;
  return { header: cells(header), rows: body.map(cells) };
}

describe("strategy §9.3, P1 table", () => {
  const { header, rows } = p1Table();

  it("has a Done column", () => {
    expect(header).toContain("Done");
  });

  it("gives every row one cell per column", () => {
    for (const row of rows) expect(row).toHaveLength(header.length);
  });

  it("has QW1 to QW12, each once", () => {
    const ids = rows.map((r) => r[0]);
    expect(ids).toEqual(Array.from({ length: 12 }, (_, i) => `QW${i + 1}`));
  });

  it("says Done on every shipped step", () => {
    const done = header.indexOf("Done");
    for (const id of SHIPPED) {
      const row = rows.find((r) => r[0] === id);
      expect(row, `${id} row`).toBeDefined();
      expect(row?.[done], `${id} Done cell`).toMatch(/^Done \(PR [12]\)$/);
    }
  });

  it("says Done on no step that is not shipped", () => {
    const done = header.indexOf("Done");
    for (const row of rows) {
      if (!SHIPPED.includes(row[0] ?? ""))
        expect(row[done], `${row[0]} Done cell`).not.toMatch(/Done/);
    }
  });

  it("notes that G2 is not in P1", () => {
    const g2 = STRATEGY.split("\n").find((l) => /^\| G2 \|/.test(l));
    expect(g2).toBeDefined();
    expect(g2).toMatch(/not in P1/i);
  });
});

// D2 (PR 2): ADR-041 records the Home order and the account control in the header, and supersedes ADR-030 decision 4.
describe("ADR-041, Home order and the account control in the header", () => {
  const adrUrl = new URL(
    "../../docs/adr/adr-041-home-order-and-header-account.md",
    import.meta.url,
  );
  const adr = existsSync(adrUrl) ? readFileSync(adrUrl, "utf8") : "";

  it("exists and names ADR-030 decision 4", () => {
    expect(adr).not.toBe("");
    expect(adr).toMatch(/ADR-030/);
    expect(adr).toMatch(/decision 4/i);
  });

  it("lists at least one rejected alternative", () => {
    const alternatives = adr.split(/^## Alternatives\s*$/m)[1] ?? "";
    expect(alternatives.split("\n").filter((l) => l.startsWith("- ")).length).toBeGreaterThan(0);
  });

  it("marks ADR-030 decision 4 as superseded by ADR-041", () => {
    const adr030 = readFileSync(
      new URL("../../docs/adr/adr-030-navigation-by-job-home-first.md", import.meta.url),
      "utf8",
    );
    expect(adr030).toMatch(/decision 4 superseded by ADR-041/i);
  });
});
