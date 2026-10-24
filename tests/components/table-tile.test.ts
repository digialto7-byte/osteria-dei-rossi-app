import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TableTileButton } from "@/app/(owner)/tavoli/table-tile";
import type { TableTile } from "@/server/tables/output";
import { IDS, TABLES_LIST } from "../helpers/menu-tables-data";

const OPEN = TABLES_LIST.tables[0]!;
const FREE = TABLES_LIST.tables[1]!;
const render = (table: TableTile) =>
  renderToStaticMarkup(createElement(TableTileButton, { table, onSelect: () => undefined }));

describe("TableTileButton", () => {
  it("is a button of at least 44 px carrying the table id", () => {
    const html = render(OPEN);
    expect(html).toMatch(/^<button/);
    expect(html).toContain(`data-table-id="${IDS.table1}"`);
    expect(html).toContain("min-h-tap");
  });

  it("an open table shows the name in bold, the status word, the covers and the waiter with the time", () => {
    const html = render(OPEN);
    expect(html).toMatch(/<[^>]*font-bold[^>]*>Tavolo 1 \(demo\)</);
    expect(html).toContain(">Aperto<");
    expect(html).toMatch(/<[^>]*class="num[^"]*"[^>]*>4 coperti</);
    // 19:15Z on 2 November is 20:15 in Rome.
    expect(html).toMatch(/<[^>]*class="num[^"]*"[^>]*>Cameriere Demo · 20:15</);
  });

  it("a free table has no covers and no waiter line", () => {
    const html = render(FREE);
    expect(html).toContain(">Libero<");
    expect(html).not.toContain("coperti");
    expect(html).not.toContain("Cameriere");
  });

  it.each([
    ["free", "Libero"],
    ["open", "Aperto"],
    ["courses_sent", "Portate inviate"],
    ["bill_requested", "Conto richiesto"],
    ["closed", "Chiuso"],
  ] as const)("the %s status says %s", (status, word) => {
    const table: TableTile = { ...OPEN, status };
    expect(render(table)).toContain(`>${word}<`);
  });

  it("adds the date when the table was opened in an earlier business day", () => {
    const table: TableTile = {
      ...OPEN,
      session: { ...OPEN.session!, openedToday: false, openedAt: "2026-10-24T23:30:00+00:00" },
    };
    expect(render(table)).toContain("Cameriere Demo · 25/10 01:30");
  });

  it("shows the opener, not the waiter who last edited the table", () => {
    expect(render(TABLES_LIST.tables[2]!)).toContain("Cameriere Due Demo · 19:00");
  });

  it("renders a name with markup as text and never shows a cost", () => {
    const html = render({ ...OPEN, name: "<script>x</script>" });
    expect(html).not.toContain("<script>");
    expect(html).not.toMatch(/Costo|Margine|Food cost|GP/);
  });
});
