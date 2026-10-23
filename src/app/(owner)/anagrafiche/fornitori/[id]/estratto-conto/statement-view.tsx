import { Card, Heading, LedgerList, LedgerRow, Muted, SubHeading } from "@/components/ui";
import { t } from "@/lib/i18n";
import { asOfText, creditRows, isStatementEmpty, totalsRows } from "@/lib/payables/statement-view";
import type { SupplierStatement } from "@/server/payables/types";
import { PayableRow } from "@/app/(owner)/pagamenti/payable-row";
import { Detail, DETAIL_LIST_CLASS } from "@/app/(owner)/fatture/detail";

/**
 * The statement for the monthly settlement: totals, open invoices, credits. Every figure is the
 * database's (the frozen payable amounts); this component words them and adds nothing up.
 */
export function StatementView({ statement }: { statement: SupplierStatement }) {
  const empty = isStatementEmpty(statement);
  return (
    <>
      <div className="flex flex-col gap-1">
        <Heading>{t("statement.title")}</Heading>
        <p className="font-bold [overflow-wrap:anywhere]">{statement.supplier.name}</p>
        <p className="num text-ink-muted">{asOfText(statement.asOf)}</p>
      </div>
      <Card className="py-1">
        <dl className={DETAIL_LIST_CLASS}>
          {totalsRows(statement.totals).map((row) => (
            <Detail
              key={row.id}
              label={row.label}
              value={row.value}
              testId={`statement-${row.id}`}
              numeric
            />
          ))}
        </dl>
      </Card>
      {empty ? (
        <Muted>{t("statement.empty")}</Muted>
      ) : (
        <>
          <SubHeading>{t("statement.invoices")}</SubHeading>
          <LedgerList>
            {statement.invoices.map((item) => (
              <PayableRow key={item.id} item={item} />
            ))}
          </LedgerList>
        </>
      )}
      {statement.credits.length > 0 && (
        <>
          <SubHeading>{t("statement.credits")}</SubHeading>
          <LedgerList>
            {creditRows(statement.credits).map((credit) => (
              <LedgerRow key={credit.id} className="flex items-start justify-between gap-3 py-3">
                <span className="num text-sm [overflow-wrap:anywhere]">{credit.line}</span>
                <span className="num shrink-0 font-bold">{credit.amount}</span>
              </LedgerRow>
            ))}
          </LedgerList>
        </>
      )}
    </>
  );
}
