import { Badge, Button } from "@/components/ui";
import { t } from "@/lib/i18n";
import { doneCountLabel } from "@/lib/kitchen/kitchen-done";
import { ticketHeading } from "@/lib/kitchen/kitchen-view";
import type { KitchenLine as Line, KitchenTicket } from "@/server/kitchen/output";
import { KitchenLine } from "./kitchen-line";

/**
 * One active comanda: the dishes sent together for one table, one course and one segue value, oldest first on the screen. Big type
 * for the table and the quantities; each dish is a tap target (see KitchenLine); "2 di 5 fatti" and "Chiudi comanda" close the card.
 * The lines are rendered in the order the server gives them (to make, voided, done). There is no price, cost or total anywhere in
 * the data.
 */
export function TicketCard({
  ticket,
  pending,
  blocked,
  onTapLine,
  onClose,
}: {
  ticket: KitchenTicket;
  /** Line ids and comanda keys with a request on the way. */
  pending: ReadonlySet<string>;
  /** Kitchen writes are online-only: every button is disabled while this is set. */
  blocked: boolean;
  onTapLine: (ticket: KitchenTicket, line: Line) => void;
  onClose: (ticket: KitchenTicket) => void;
}) {
  const heading = ticketHeading(ticket);
  return (
    <article
      data-ticket-key={ticket.key}
      className="flex flex-col gap-3 rounded-card border border-rule bg-surface p-4"
    >
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h2 className="font-display text-[1.75rem] leading-tight font-semibold [overflow-wrap:anywhere]">
            {heading.table}
          </h2>
          <span className="num font-bold">{heading.covers}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-lg font-bold">{heading.course}</span>
          {heading.segueBadge && <Badge tone="info">{heading.segueBadge}</Badge>}
        </div>
        <span className="text-ink-muted">{heading.sent}</span>
        <span data-done-count={ticket.doneCount} className="num font-bold">
          {doneCountLabel(ticket.doneCount, ticket.lineCount)}
        </span>
      </header>
      <ul className="flex flex-col">
        {ticket.lines.map((line) => (
          <KitchenLine
            key={line.id}
            line={line}
            pending={pending.has(line.id)}
            blocked={blocked}
            onTap={() => onTapLine(ticket, line)}
          />
        ))}
      </ul>
      <Button
        variant="secondary"
        className="w-full"
        aria-label={t("kitchen.close.aria", { table: heading.table, course: heading.course })}
        disabled={blocked || pending.has(ticket.key)}
        onClick={() => onClose(ticket)}
      >
        {t("kitchen.close")}
      </Button>
    </article>
  );
}
