import Link from "next/link";
import { Badge } from "@/components/ui";
import { t } from "@/lib/i18n";
import type { ShownTile } from "@/lib/sync/overlay-tables";
import { comandaHref } from "@/lib/tables/comanda-url";
import { coversLine, sessionMetaLine, statusTone, statusWord } from "@/lib/tables/table-view";

const TILE =
  "flex min-h-tap min-w-0 flex-col items-start gap-1.5 rounded-card border border-rule bg-surface p-3 " +
  "text-left shadow-[0_1px_0_rgb(0_0_0/0.03)]";

/**
 * One table of the grid, a whole-tile target of at least 44 px: the name in bold, the status word with its tone, and for a table with a
 * session the covers and the opener with the time. The status is the server's derivation; the waiter shown is who opened the table,
 * whoever edited it since. Names are rendered as text.
 *
 * An occupied table is a link straight to its comanda (direct comanda, docs/ux/p3-sala-waiter.md §10.1): `onEnter` runs on the tap, so the
 * page can remember the grid's scroll position. A free or closed table is a button: `onOpen` asks for the covers (the table is opened as
 * a queued operation). A table joined to a seated booking (status "joined") is neither: it reads "Unito a <lead>" from the reply and cannot
 * be opened from here, because the party sits at the lead table (the database refuses `open_table` on it too).
 */
export function TableTile({
  table,
  onOpen,
  onEnter,
}: {
  table: ShownTile;
  onOpen: () => void;
  onEnter: () => void;
}) {
  const { session } = table;
  if (table.status === "joined") {
    return (
      <div data-table-id={table.id} aria-disabled="true" className={TILE}>
        <span className="text-lg font-bold [overflow-wrap:anywhere]">{table.name}</span>
        <Badge tone={statusTone(table.status)}>
          {table.joinedTo
            ? t(table.joinedTo.overtime ? "tables.joinedToOvertime" : "tables.joinedTo", {
                name: table.joinedTo.name,
              })
            : statusWord(table.status)}
        </Badge>
      </div>
    );
  }
  const body = (
    <>
      <span className="text-lg font-bold [overflow-wrap:anywhere]">{table.name}</span>
      <Badge tone={statusTone(table.status)}>{statusWord(table.status)}</Badge>
      {session && (
        <>
          <span className="num text-sm">{coversLine(session.covers)}</span>
          <span className="num text-sm text-ink-muted [overflow-wrap:anywhere]">
            {sessionMetaLine(session, new Date())}
          </span>
        </>
      )}
    </>
  );
  const className = `${TILE} transition-colors duration-150 hover:border-rule-strong hover:bg-sunk`;
  // A closed table keeps its last session in the reply but is free to open again.
  if (session !== null && table.status !== "closed") {
    return (
      <Link
        href={comandaHref(session.id)}
        data-table-id={table.id}
        data-contrast-box
        onClick={onEnter}
        className={className}
      >
        {body}
      </Link>
    );
  }
  return (
    <button
      type="button"
      data-table-id={table.id}
      data-contrast-box
      onClick={onOpen}
      className={className}
    >
      {body}
    </button>
  );
}
