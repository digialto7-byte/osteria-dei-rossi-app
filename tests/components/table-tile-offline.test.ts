// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { cleanup, createEvent, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDS, shownTile, TABLES_LIST } from "../helpers/menu-tables-data";

// Direct comanda (docs/ux/p3-sala-waiter.md §10.1): an occupied tile opens its comanda. Offline the client router cannot fetch the
// comanda, so the tap is a full page load (served by the service worker), exactly as opening a table does in tavoli/page.tsx.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

const { TableTile } = await import("@/app/(owner)/tavoli/table-tile");

const OPEN = shownTile(TABLES_LIST.tables[0]!);
const COMANDA = `/tavoli/comanda?s=${IDS.session1}`;
const assign = vi.fn();
const online = vi.spyOn(navigator, "onLine", "get");

beforeEach(() => {
  assign.mockClear();
  vi.stubGlobal("location", { ...window.location, assign });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function tapOccupied() {
  const onEnter = vi.fn();
  const { container } = render(
    createElement(TableTile, { table: OPEN, onOpen: () => undefined, onEnter }),
  );
  const link = container.querySelector(`[data-table-id="${IDS.table1}"]`)!;
  const click = createEvent.click(link);
  fireEvent(link, click);
  return { onEnter, defaultPrevented: click.defaultPrevented };
}

describe("TableTile, occupied, the tap", () => {
  it("offline: remembers the grid, then loads the comanda as a full page, not through the client router", () => {
    online.mockReturnValue(false);
    const { onEnter, defaultPrevented } = tapOccupied();
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(defaultPrevented).toBe(true);
    expect(assign).toHaveBeenCalledExactlyOnceWith(COMANDA);
  });

  it("online: remembers the grid and leaves the navigation to the link (no full page load)", () => {
    online.mockReturnValue(true);
    const { onEnter, defaultPrevented } = tapOccupied();
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(defaultPrevented).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });
});
