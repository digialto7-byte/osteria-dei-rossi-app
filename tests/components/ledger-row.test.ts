// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Badge, LedgerList, LedgerRow, type LedgerRowProps } from "@/components/ui";

afterEach(cleanup);

const inList = (row: ReturnType<typeof createElement>) =>
  render(createElement(LedgerList, null, row));

describe("LedgerRow with title, meta and trailing", () => {
  it("lays out the title, the meta line and the trailing slot in reading order", () => {
    inList(
      createElement(LedgerRow, {
        title: "Fornitore Uno",
        meta: "Scade tra 3 giorni",
        trailing: createElement(Badge, { tone: "warning" }, "In scadenza"),
      }),
    );
    const row = screen.getByRole("listitem");
    const text = row.textContent ?? "";
    expect(text.indexOf("Fornitore Uno")).toBeLessThan(text.indexOf("Scade tra 3 giorni"));
    expect(text.indexOf("Scade tra 3 giorni")).toBeLessThan(text.indexOf("In scadenza"));
    expect(screen.getByText("Fornitore Uno").className).toContain("font-bold");
    expect(screen.getByText("Scade tra 3 giorni").className).toContain("text-ink-muted");
  });

  it("a row without meta or trailing renders neither", () => {
    inList(createElement(LedgerRow, { title: "Solo titolo" }));
    const row = screen.getByRole("listitem");
    expect(row.textContent).toBe("Solo titolo");
    expect(row.querySelector("[data-ledger-meta]")).toBeNull();
    expect(row.querySelector("[data-ledger-trailing]")).toBeNull();
  });

  it("long unbroken title and meta wrap instead of widening the page", () => {
    const long = "X".repeat(80);
    inList(createElement(LedgerRow, { title: long, meta: long + "Y" }));
    expect(screen.getByText(long).className).toContain("[overflow-wrap:anywhere]");
    expect(screen.getByText(long + "Y").className).toContain("[overflow-wrap:anywhere]");
  });

  it("with an href the whole row is one link, at least 44 px tall, in the same order", () => {
    inList(
      createElement(LedgerRow, {
        href: "/fatture/abc",
        title: "Fornitore Due",
        meta: "Riga meta",
        trailing: createElement(Badge, { tone: "danger" }, "Scaduta"),
      }),
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/fatture/abc");
    expect(link.className).toContain("min-h-tap");
    expect(link.textContent).toBe("Fornitore DueRiga metaScaduta");
    expect(screen.getByRole("listitem").contains(link)).toBe(true);
  });

  it("without an href there is no link and no tap-target class", () => {
    inList(createElement(LedgerRow, { title: "Nessun link" }));
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("listitem").innerHTML).not.toContain("min-h-tap");
  });

  it("keeps li attributes and a caller class on the item", () => {
    inList(createElement(LedgerRow, { title: "T", className: "num", ...{ "data-x": "1" } }));
    const row = screen.getByRole("listitem");
    expect(row.className).toContain("num");
    expect(row.getAttribute("data-x")).toBe("1");
  });

  it("free-form children still render as before", () => {
    inList(createElement(LedgerRow, { className: "py-2" }, "a mano"));
    expect(screen.getByRole("listitem").textContent).toBe("a mano");
  });

  it("does not allow a title together with children", () => {
    // @ts-expect-error title and children are two shapes of one row, never both
    const both: LedgerRowProps = { title: "T", children: "x" };
    expect(both.title).toBe("T");
  });

  it("has no badge prop any more: the end slot is trailing", () => {
    // @ts-expect-error badge was renamed to trailing, with no alias
    const old: LedgerRowProps = { title: "T", badge: "x" };
    expect(old.title).toBe("T");
  });
});
