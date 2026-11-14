import { Badge } from "@/components/ui";
import { t } from "@/lib/i18n";
import { coversLine, openedLine, statusTone, statusWord } from "@/lib/tables/table-view";
import type { TableTile } from "@/server/tables/output";

const TILE =
  "flex min-h-tap min-w-0 flex-col items-start gap-1.5 rounded-card border border-rule bg-surface p-3 " +
  "text-left shadow-[0_1px_0_rgb(0_0_0/0.03)]";

/**
 * One table of the grid, a whole-tile button of at least 44 px: the name in bold, the status word with its tone,
 * and for a table with a session the covers and the opener with the time. The status is the server's derivation;
 * the waiter shown is who opened the table, whoever edited it since. Names are rendered as text.
 *
 * A table joined to a seated booking (status "joined") is not a button: it reads "Unito a <lead>" from the reply and cannot be opened from here,
 * because the party sits at the lead table (the database refuses `open_table` on it too).
 */
export function TableTileButton({ table, onSelect }: { table: TableTile; onSelect: () => void }) {
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
  return (
    <button
      type="button"
      data-table-id={table.id}
      data-contrast-box
      onClick={onSelect}
      className={`${TILE} transition-colors duration-150 hover:border-rule-strong hover:bg-sunk`}
    >
      <span className="text-lg font-bold [overflow-wrap:anywhere]">{table.name}</span>
      <Badge tone={statusTone(table.status)}>{statusWord(table.status)}</Badge>
      {session && (
        <>
          <span className="num text-sm">{coversLine(session.covers)}</span>
          <span className="num text-sm text-ink-muted [overflow-wrap:anywhere]">
            {openedLine(session.waiter.displayName, session.openedAt, session.openedToday)}
          </span>
        </>
      )}
    </button>
  );
}
