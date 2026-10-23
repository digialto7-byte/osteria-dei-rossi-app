import { t } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { formatCalendarDate } from "@/lib/time/format";
import { amountText, creditText, invoiceLine } from "./payable-view";
import type { SupplierStatement } from "@/server/payables/types";

// Presentation helpers for the supplier statement. Pure: the totals and the credits are the
// database's figures, worded here; nothing is added up or recomputed.

export interface TotalsRow {
  id: "invoices" | "credits" | "balance" | "disputed";
  label: string;
  value: string;
}

/** "al 25/10/2026" */
export const asOfText = (asOf: string, locale: Locale = DEFAULT_LOCALE) =>
  t("statement.asOf", { date: formatCalendarDate(asOf, locale) }, locale);

/** The rows of the totals sheet; "of which disputed" appears only when something is disputed. */
export function totalsRows(
  totals: SupplierStatement["totals"],
  locale: Locale = DEFAULT_LOCALE,
): TotalsRow[] {
  const rows: TotalsRow[] = [
    {
      id: "invoices",
      label: t("statement.totals.invoices", {}, locale),
      value: amountText(totals.invoicesTotal, locale),
    },
    {
      id: "credits",
      label: t("statement.totals.credits", {}, locale),
      value: creditText(totals.creditsTotal, locale),
    },
    {
      id: "balance",
      label: t("statement.totals.balance", {}, locale),
      value: amountText(totals.balance, locale),
    },
  ];
  if (totals.disputedAmount > 0) {
    rows.push({
      id: "disputed",
      label: t("statement.totals.disputed", {}, locale),
      value: amountText(totals.disputedAmount, locale),
    });
  }
  return rows;
}

/** One credited invoice: "Fattura 123/A del 01/12/2026" and "−50,00 €". */
export function creditRows(
  credits: SupplierStatement["credits"],
  locale: Locale = DEFAULT_LOCALE,
): { id: string; line: string; amount: string }[] {
  return credits.map((credit) => ({
    id: credit.payableId,
    line: invoiceLine(credit.invoiceNumber, credit.invoiceDate, locale),
    amount: creditText(credit.creditedAmount, locale),
  }));
}

export const isStatementEmpty = (statement: SupplierStatement) => statement.invoices.length === 0;
