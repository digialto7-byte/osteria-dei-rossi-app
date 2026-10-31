"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { t } from "@/lib/i18n";
import { closedLabel, closedSectionLabel, doneCountLabel } from "@/lib/kitchen/kitchen-done";
import { firedLine, ticketHeading } from "@/lib/kitchen/kitchen-view";
import type { KitchenTicket } from "@/server/kitchen/output";

const STORAGE_KEY = "kitchen.closedOpen";

function storedOpen(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/** The section starts collapsed; the device's last choice is a UI preference in localStorage, not data. */
function useClosedOpen(): [boolean, (next: boolean) => void] {
  const [open, setOpen] = useState(storedOpen);
  const set = (next: boolean) => {
    setOpen(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // A browser that refuses storage keeps the choice for this visit only.
    }
  };
  return [open, set];
}

/**
 * "Chiuse oggi (n)": the comande closed today, collapsed by default. Each is a compact read-only card (done dishes struck, no dish
 * button) with the time it closed, who closed it when it was by hand, and "Riapri". The label and the order come from the server.
 */
export function ClosedSection({
  tickets,
  pending,
  blocked,
  onReopen,
}: {
  tickets: readonly KitchenTicket[];
  pending: ReadonlySet<string>;
  blocked: boolean;
  onReopen: (ticket: KitchenTicket) => void;
}) {
  const [open, setOpen] = useClosedOpen();
  const label = closedSectionLabel(tickets);
  if (label === null) return null;
  return (
    <section className="flex flex-col gap-3">
      <Button
        variant="secondary"
        className="self-start"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {label}
      </Button>
      {open && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-4">
          {tickets.map((ticket) => {
            const heading = ticketHeading(ticket);
            return (
              <article
                key={ticket.key}
                data-ticket-key={ticket.key}
                className="flex flex-col gap-2 rounded-card border border-rule bg-surface p-4"
              >
                <header className="flex flex-col gap-1">
                  <h3 className="font-display text-xl leading-tight font-semibold [overflow-wrap:anywhere]">
                    {heading.table}
                  </h3>
                  <span className="font-bold">{heading.course}</span>
                  <span className="num font-bold">
                    {doneCountLabel(ticket.doneCount, ticket.lineCount)}
                  </span>
                  <span className="text-ink-muted">{closedLabel(ticket)}</span>
                </header>
                <ul className="flex flex-col">
                  {ticket.lines.map((line) => {
                    const view = firedLine(line);
                    return (
                      <li
                        key={line.id}
                        data-line-id={line.id}
                        className="border-t border-rule py-1 text-ink-muted"
                      >
                        <span
                          className={`[overflow-wrap:anywhere]${view.done || view.voided ? " line-through" : ""}`}
                        >
                          {view.text}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <Button
                  variant="secondary"
                  className="w-full"
                  aria-label={t("kitchen.reopen.aria", {
                    table: heading.table,
                    course: heading.course,
                  })}
                  disabled={blocked || pending.has(ticket.key)}
                  onClick={() => onReopen(ticket)}
                >
                  {t("kitchen.reopen")}
                </Button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
