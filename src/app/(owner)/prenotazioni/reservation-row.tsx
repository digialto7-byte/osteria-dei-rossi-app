import { Badge, Button, Card, Muted } from "@/components/ui";
import {
  actionLabel,
  emailWord,
  joinedLines,
  rowTitle,
  statusTone,
  statusWord,
  tablesLine,
  type RowView,
} from "@/lib/reservations/day-view";
import type { ReservationAction } from "@/server/reservations/constants";

/**
 * One booking of the day. The buttons are exactly the `actions` the database listed for this caller and this status (the waiter's list has no "Accetta"); nothing here
 * decides what may be done. The name, phone and e-mail are rendered as text, the phone as a `tel:` link. An error of a direct action (arrived, no-show, split) shows on its row.
 */
export function ReservationRow({
  row,
  busy,
  error,
  onAction,
}: {
  row: RowView;
  busy: boolean;
  error: string | null;
  onAction: (action: ReservationAction) => void;
}) {
  const tables = tablesLine(row);
  const email = emailWord(row.emailStatus);
  return (
    <Card
      data-reservation-id={row.id}
      role="group"
      aria-label={rowTitle(row)}
      className="flex flex-col gap-2"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="num text-lg font-bold [overflow-wrap:anywhere]">{rowTitle(row)}</p>
        <Badge tone={statusTone(row.status)}>{statusWord(row.status)}</Badge>
      </div>
      {tables && <p className="[overflow-wrap:anywhere]">{tables}</p>}
      {joinedLines(row).map((line) => (
        <p key={line} className="text-sm text-ink-muted [overflow-wrap:anywhere]">
          {line}
        </p>
      ))}
      {row.phone && (
        <a
          href={`tel:${row.phone}`}
          className="num inline-flex min-h-tap items-center font-bold text-accent-ink underline underline-offset-4"
        >
          {row.phone}
        </a>
      )}
      {row.email && <p className="text-sm [overflow-wrap:anywhere]">{row.email}</p>}
      {email && <Muted>{email}</Muted>}
      {row.actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {row.actions.map((action) => (
            <Button
              key={action}
              variant={action === "erase" ? "quiet" : action === "accept" ? "primary" : "secondary"}
              disabled={busy}
              onClick={() => onAction(action)}
            >
              {actionLabel(action)}
            </Button>
          ))}
        </div>
      )}
      <div aria-live="polite">
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
      </div>
    </Card>
  );
}
