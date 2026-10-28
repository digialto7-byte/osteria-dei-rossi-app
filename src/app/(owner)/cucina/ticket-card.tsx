import { Badge } from "@/components/ui";
import { t } from "@/lib/i18n";
import { firedLine, ticketHeading } from "@/lib/kitchen/kitchen-view";
import type { KitchenTicket } from "@/server/kitchen/output";

/**
 * One ticket of the kitchen list: the dishes sent together for one table, one course and one segue value, oldest first
 * on the screen. Big type for the table and the quantities; a voided dish is struck through and says why in words (never
 * by colour alone); notes and names are text. There is no price, cost or total anywhere in the data.
 */
export function TicketCard({ ticket }: { ticket: KitchenTicket }) {
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
      </header>
      <ul className="flex flex-col">
        {ticket.lines.map((line) => {
          const view = firedLine(line);
          return (
            <li
              key={line.id}
              data-line-id={line.id}
              className="flex flex-col gap-1 border-t border-rule py-2 text-lg"
            >
              <span
                className={`font-bold [overflow-wrap:anywhere]${view.voided ? " line-through" : ""}`}
              >
                {view.text}
              </span>
              {view.shared && <Badge tone="neutral">{t("orders.line.shared")}</Badge>}
              {view.note && <span className="[overflow-wrap:anywhere]">{view.note}</span>}
              {view.voidText && <span className="font-bold">{view.voidText}</span>}
            </li>
          );
        })}
      </ul>
    </article>
  );
}
