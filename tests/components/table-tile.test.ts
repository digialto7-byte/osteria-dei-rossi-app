import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TableTile } from "@/app/(owner)/tavoli/table-tile";
import type { ShownTile } from "@/lib/sync/overlay-tables";
import { IDS, shownTile, TABLES_LIST } from "../helpers/menu-tables-data";

const OPEN = shownTile(TABLES_LIST.tables[0]!);
const FREE = shownTile(TABLES_LIST.tables[1]!);
const render = (table: ShownTile) =>
  renderToStaticMarkup(
    createElement(TableTile, { table, onOpen: () => undefined, onEnter: () => undefined }),
  );

describe("TableTile", () => {
  it("an occupied table is a link straight to its comanda, of at least 44 px, carrying the table id", () => {
    const html = render(OPEN);
    expect(html).toMatch(/^<a /);
    expect(html).toContain(`href="/tavoli/comanda?s=${IDS.session1}"`);
    expect(html).not.toContain("<button");
    expect(html).toContain(`data-table-id="${IDS.table1}"`);
    expect(html).toContain("min-h-tap");
  });

  it("a free table is a button and not a link", () => {
    const html = render(FREE);
    expect(html).toMatch(/^<button/);
    expect(html).not.toContain("href=");
    expect(html).toContain(`data-table-id="${IDS.table2}"`);
    expect(html).toContain("data-contrast-box");
  });

  it("a closed table with its last session reads as free: a button to open it again", () => {
    expect(render({ ...OPEN, status: "closed" })).toMatch(/^<button/);
  });

  it("marks the tile for the high-contrast border", () => {
    expect(render(OPEN)).toContain("data-contrast-box");
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
    const table: ShownTile = { ...OPEN, status };
    expect(render(table)).toContain(`>${word}<`);
  });

  describe("a table joined to a seated booking (reservations V4)", () => {
    const JOINED: ShownTile = {
      id: IDS.table2,
      name: "Tavolo 2 (demo)",
      position: 2,
      status: "joined",
      session: null,
      joinedTo: { id: IDS.table1, name: "Tavolo 1 (demo)", overtime: false },
    };

    it("is not a button: nothing to tap, no handler", () => {
      const html = render(JOINED);
      expect(html).not.toMatch(/<button|<a /);
      expect(html).toContain(`data-table-id="${IDS.table2}"`);
      expect(html).toContain('aria-disabled="true"');
    });

    it("adds 'oltre l'orario' only when the booking is past its end", () => {
      expect(render(JOINED)).not.toContain("oltre");
      const late: ShownTile = { ...JOINED, joinedTo: { ...JOINED.joinedTo!, overtime: true } };
      const html = render(late);
      expect(html).toContain(">Unito a Tavolo 1 (demo) (oltre l&#x27;orario)<");
      expect(html).not.toMatch(/<button/);
    });

    it("reads 'Unito a Tavolo 1 (demo)' from the reply, and has no covers or waiter", () => {
      const html = render(JOINED);
      expect(html).toContain(">Unito a Tavolo 1 (demo)<");
      expect(html).toMatch(/<[^>]*font-bold[^>]*>Tavolo 2 \(demo\)</);
      expect(html).not.toContain("coperti");
      expect(html).not.toContain("Cameriere");
    });
  });

  it("adds the date when the table was opened in an earlier business day", () => {
    const table: ShownTile = {
      ...OPEN,
      session: {
        ...TABLES_LIST.tables[0]!.session!,
        source: "server",
        openedToday: false,
        openedAt: "2026-10-24T23:30:00+00:00",
      },
    };
    expect(render(table)).toContain("Cameriere Demo · 25/10 01:30");
  });

  it("shows the opener, not the waiter who last edited the table", () => {
    expect(render(shownTile(TABLES_LIST.tables[2]!))).toContain("Cameriere Due Demo · 19:00");
  });

  it("renders a name with markup as text and never shows a cost", () => {
    const html = render({ ...OPEN, name: "<script>x</script>" });
    expect(html).not.toContain("<script>");
    expect(html).not.toMatch(/Costo|Margine|Food cost|GP/);
  });

  describe("a table opened on this phone and not yet applied (source: queued)", () => {
    const queuedAt = (at: string): ShownTile => ({
      ...OPEN,
      session: {
        source: "queued",
        id: IDS.session1,
        covers: 4,
        waiter: { id: IDS.waiterA, displayName: "Giulia" },
        billRequested: false,
        unsentCount: 0,
        uscite: null,
        queuedAt: at,
      },
    });
    afterEach(() => vi.useRealTimers());

    it("is a link to the comanda of the session this phone made, so it opens offline too", () => {
      expect(render(queuedAt("2026-11-02T19:14:00Z"))).toContain(
        `href="/tavoli/comanda?s=${IDS.session1}"`,
      );
    });

    it("the tap was today in Rome: covers, the waiter with the time and 'Apertura in coda'", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-02T21:00:00Z"));
      const html = render(queuedAt("2026-11-02T19:14:00Z"));
      expect(html).toMatch(/<[^>]*class="num[^"]*"[^>]*>4 coperti</);
      expect(html).toMatch(/<[^>]*class="num[^"]*"[^>]*>Giulia · 20:14 · Apertura in coda</);
    });

    it("the phone stayed offline past Rome midnight: the date is shown", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-02T23:30:00Z")); // 00:30 on the 3rd in Rome
      expect(render(queuedAt("2026-11-02T19:14:00Z"))).toMatch(
        /<[^>]*class="num[^"]*"[^>]*>Giulia · 02\/11 20:14 · Apertura in coda</,
      );
    });
  });

  describe("W2: 'Da inviare · n' (P2b-9)", () => {
    const withUnsent = (n: number | undefined): ShownTile => {
      const { unsentCount: _dropped, ...rest } = TABLES_LIST.tables[0]!.session!;
      return shownTile({
        ...TABLES_LIST.tables[0]!,
        session: n === undefined ? rest : { ...rest, unsentCount: n },
      } as never);
    };
    const badge = (html: string) =>
      html.match(
        /<span[^>]*data-tone="warning"[^>]*>(?:(?!<\/span><\/span>).)*Da inviare · \d+<\/span>/,
      )?.[0] ?? null;

    it("shows a warning badge after the opener line when n > 0", () => {
      const html = render(withUnsent(2));
      const found = badge(html);
      expect(found).not.toBeNull();
      expect(found).toContain('data-tone="warning"');
      expect(html.indexOf("Cameriere Demo · 20:15")).toBeLessThan(html.indexOf("Da inviare · 2"));
      expect(html.indexOf("Da inviare · 2")).toBeGreaterThan(html.indexOf("4 coperti"));
    });

    it("shows nothing for 0, nothing when the reply has no count, and nothing on a free tile", () => {
      expect(render(withUnsent(0))).not.toContain("Da inviare");
      expect(render(withUnsent(undefined))).not.toContain("Da inviare");
      expect(render(FREE)).not.toContain("Da inviare");
    });

    it("a table opened on this phone shows its own real count", () => {
      const queued: ShownTile = {
        ...OPEN,
        session: {
          source: "queued",
          id: IDS.session1,
          covers: 4,
          waiter: { id: IDS.waiterA, displayName: "Giulia" },
          billRequested: false,
          unsentCount: 3,
          uscite: null,
          queuedAt: "2026-11-02T19:14:00Z",
        },
      };
      expect(render(queued)).toContain("Da inviare · 3");
    });

    it("the link's accessible name is tileLabel and carries the count; a free tile has its own name", () => {
      expect(render(withUnsent(2))).toContain(
        'aria-label="Tavolo 1 (demo), Aperto, 4 coperti, Cameriere Demo alle 20:15, 2 piatti da inviare"',
      );
      expect(render(FREE)).toContain('aria-label="Tavolo 2 (demo), Libero"');
    });

    it("shows no cost word", () => {
      expect(render(withUnsent(2))).not.toMatch(/Costo|Margine|Food cost|€/);
    });
  });
});
