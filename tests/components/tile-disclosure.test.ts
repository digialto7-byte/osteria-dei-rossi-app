// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PayablesTile } from "@/components/dashboard/payables-tile";
import { Tile } from "@/components/dashboard/tile";
import { renderDashboard } from "@/server/dashboard/render";
import { dashboardSqlSchema } from "@/server/dashboard/sql-schema";
import { ownerSql } from "../fixtures/dashboard-sql";

afterEach(cleanup);

// M25b step 14 (plan §3.1.8): the compact tile and its "Dettagli" disclosure. Closed, the body is not rendered at all, so its links are not
// in the accessibility tree.
const payables = () => {
  const out = renderDashboard(dashboardSqlSchema.parse(ownerSql()), "it");
  if (out.role !== "owner") throw new Error("owner expected");
  return out.tiles.payables;
};

describe("Tile with a disclosure", () => {
  it("starts closed: heading, headline, link, a 44 px Dettagli button, and no body", () => {
    const tile = payables();
    render(createElement(PayablesTile, { tile }));
    const heading = screen.getByRole("heading", { level: 2, name: "Pagamenti" });
    expect(screen.getByRole("link", { name: "Apri pagamenti" }).getAttribute("href")).toBe(
      "/pagamenti",
    );
    const button = screen.getByRole("button", { name: "Dettagli" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-controls")).toBe("tile-payables-body");
    expect(button.getAttribute("aria-describedby")).toBe(heading.id);
    expect(button.className).toContain("min-h-tap");
    expect(document.getElementById("tile-payables-body")).toBeNull();
    expect(
      screen.queryByRole("link", { name: new RegExp(tile.items[0]!.supplierName) }),
    ).toBeNull();
  });

  it("opens on a click, showing today's rows inside the controlled element, and closes on another", () => {
    const tile = payables();
    render(createElement(PayablesTile, { tile }));
    const button = screen.getByRole("button", { name: "Dettagli" });
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const body = document.getElementById("tile-payables-body")!;
    expect(body.textContent).toContain(tile.items[0]!.supplierName);
    expect(body.querySelectorAll("a").length).toBe(tile.items.length);
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById("tile-payables-body")).toBeNull();
  });

  it("keeps the tile's one link visible in both states", () => {
    render(createElement(PayablesTile, { tile: payables() }));
    expect(screen.getAllByRole("link", { name: "Apri pagamenti" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Dettagli" }));
    expect(screen.getAllByRole("link", { name: "Apri pagamenti" })).toHaveLength(1);
  });

  it("two tiles keep their own state and ids", () => {
    render(
      createElement(
        "div",
        null,
        createElement(Tile, { tileKey: "a", title: "A", headline: "una riga" }, "corpo A"),
        createElement(Tile, { tileKey: "b", title: "B", headline: "due righe" }, "corpo B"),
      ),
    );
    const [first] = screen.getAllByRole("button", { name: "Dettagli" });
    fireEvent.click(first!);
    expect(document.getElementById("tile-a-body")?.textContent).toBe("corpo A");
    expect(document.getElementById("tile-b-body")).toBeNull();
  });

  it("a tile without a headline renders as before: its content, no button", () => {
    render(createElement(Tile, { tileKey: "c", title: "C" }, "sempre qui"));
    expect(screen.getByText("sempre qui")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Dettagli" })).toBeNull();
  });
});
