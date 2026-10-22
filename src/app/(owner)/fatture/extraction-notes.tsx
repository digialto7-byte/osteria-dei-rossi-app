import { isMessageKey, t, type MessageKey } from "@/lib/i18n";
import { formatEuro } from "@/lib/money/format";
import type { InvoiceItem } from "@/server/invoices/invoices";

type Notes = Pick<
  InvoiceItem,
  "status" | "gateFlags" | "extractionError" | "totalsDiff" | "duplicateOf" | "duplicateWarningOf"
>;

const WAITING_OR_FAILED = ["received", "extraction_failed"];

/** The Italian text for a code the server sent; an unknown code is shown as it is, never hidden. */
function label(prefix: "gateFlag" | "extractionError", code: string): string {
  const key = `${prefix}.${code}`;
  return isMessageKey(key) ? t(key as MessageKey) : code;
}

/**
 * What the reading found out about an invoice: why it failed or waits, which checks flagged it,
 * and the duplicate notices. Display only: every value comes from the API.
 */
export function ExtractionNotes({ invoice }: { invoice: Notes }) {
  const notes: { id: string; text: string }[] = [];
  if (invoice.extractionError && WAITING_OR_FAILED.includes(invoice.status)) {
    notes.push({ id: "error", text: label("extractionError", invoice.extractionError) });
  }
  for (const flag of invoice.gateFlags) {
    let text = label("gateFlag", flag);
    if (flag === "total_mismatch" && invoice.totalsDiff !== null) {
      text = `${text}. ${t("invoices.totalsDiff", { amount: formatEuro(invoice.totalsDiff) })}`;
    }
    notes.push({ id: `flag-${flag}`, text });
  }
  if (invoice.duplicateOf) notes.push({ id: "duplicate", text: t("invoices.duplicateOf") });
  if (invoice.duplicateWarningOf) {
    notes.push({ id: "warning", text: t("invoices.duplicateWarning") });
  }
  if (notes.length === 0) return null;
  return (
    <ul aria-label={t("invoices.checks")} className="flex flex-col gap-1">
      {notes.map((note) => (
        <li
          key={note.id}
          data-testid="invoice-note"
          className="rounded-md border-l-4 border-warning bg-warning-bg px-3 py-2 text-sm text-warning"
        >
          {note.text}
        </li>
      ))}
    </ul>
  );
}
