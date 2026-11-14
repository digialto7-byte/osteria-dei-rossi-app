import Link from "next/link";
import type { ReactNode } from "react";
import { LedgerList, LedgerRow, Muted, SubHeading, linkClass } from "@/components/ui";
import { t } from "@/lib/i18n";
import {
  formatShortDate,
  lotHref,
  plateLine,
  reachedLotText,
  type PlateGroup,
} from "@/lib/trace/trace-view";

// Pieces the trace pages share. Presentation only: every figure and every order is the API's.

/** The house "something is missing" notice in the info tone: said in words, never by colour alone. */
export const infoNoteClass =
  "rounded-lg border-l-4 border-info bg-info-bg px-4 py-3 leading-snug text-info [overflow-wrap:anywhere]";

export const FACT_LIST_CLASS = "grid grid-cols-[auto_minmax(min-content,1fr)] gap-x-4 gap-y-2";

/** A label and its value in a fact sheet. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="num [overflow-wrap:anywhere]">{children}</dd>
    </>
  );
}

/** "Fattura n. 418 del 13 nov", a link to the invoice: owner and admin only (the reply carries `invoice` for them). */
export function InvoiceLink({
  invoice,
}: {
  invoice: { id: string; number: string | null; date: string };
}) {
  const date = formatShortDate(invoice.date);
  return (
    <Link href={`/fatture/${invoice.id}`} className={linkClass}>
      {invoice.number === null
        ? t("trace.invoice.noNumber", { date })
        : t("trace.invoice", { number: invoice.number, date })}
    </Link>
  );
}

/** One lot reached from a batch or a plate: its code, supplier and delivery, a link to the lot, the invoice below it for owner and admin. */
export function ReachedLot({
  lot,
  lead,
  qty,
}: {
  lot: {
    lotId: string;
    lotCode: string | null;
    receivedOn: string;
    supplier: { name: string };
    invoice?: { id: string; number: string | null; date: string };
  };
  lead: string;
  qty?: string;
}) {
  return (
    <LedgerRow className="flex flex-col py-1">
      <Link href={lotHref(lot.lotId)} className={`${linkClass} num [overflow-wrap:anywhere]`}>
        {reachedLotText({ lead, qty, lot })} ›
      </Link>
      {lot.invoice ? <InvoiceLink invoice={lot.invoice} /> : null}
    </LedgerRow>
  );
}

/** The plates of a trace, a day and a dish a line, or the sentence that there are none (`none` is passed when the absence must be said). */
export function PlatesSection({
  plates,
  truncated,
  none,
}: {
  plates: readonly PlateGroup[];
  truncated: boolean;
  none?: string;
}) {
  if (plates.length === 0 && !none) return null;
  return (
    <section className="flex flex-col gap-2">
      <SubHeading>{t("trace.plates")}</SubHeading>
      {plates.length === 0 ? (
        <Muted>{none}</Muted>
      ) : (
        <LedgerList>
          {plates.map((plate) => (
            <LedgerRow
              key={`${plate.businessDate}-${plate.menuItemId}-${plate.via}`}
              className="num py-3 [overflow-wrap:anywhere]"
            >
              {plateLine(plate)}
            </LedgerRow>
          ))}
        </LedgerList>
      )}
      {truncated ? <Muted>{t("trace.truncated.more", { count: plates.length })}</Muted> : null}
    </section>
  );
}
