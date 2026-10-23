import { LedgerList, LedgerRow, SubHeading } from "@/components/ui";
import { checkRowText } from "@/lib/costing/cost-view";
import { isMessageKey, t, type MessageKey } from "@/lib/i18n";
import type { CostCheckResponse } from "@/server/costing/cost-check-run";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <SubHeading>{title}</SubHeading>
      <LedgerList>{children}</LedgerList>
    </section>
  );
}

const rowLabel = (row: number) => t("costs.check.row", { row });

const codeText = (code: string) => {
  const key = `costCode.${code}`;
  return isMessageKey(key) ? t(key as MessageKey) : code;
};

/** The answer of the Gate 1 check: the plates out of tolerance, then the rows that were not compared. */
export function CostCheckResultView({ result }: { result: CostCheckResponse }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="num font-bold">
        {t("costs.check.summary", {
          compared: result.compared,
          tolerance: result.tolerancePct,
          listed: result.listed.length,
        })}
      </p>
      {result.listed.length === 0 ? (
        <p>{t("costs.check.allWithin")}</p>
      ) : (
        <LedgerList>
          {result.listed.map((item) => (
            <LedgerRow key={item.row} className="flex flex-col gap-1 py-3">
              <span className="[overflow-wrap:anywhere]">{item.name}</span>
              <p className="num text-sm text-ink-muted">{checkRowText(item)}</p>
            </LedgerRow>
          ))}
        </LedgerList>
      )}
      {result.unmatched.length > 0 && (
        <Section title={t("costs.check.unmatched")}>
          {result.unmatched.map((item) => (
            <LedgerRow key={item.row} className="py-2 [overflow-wrap:anywhere]">
              {item.name} <span className="text-ink-muted">({rowLabel(item.row)})</span>
            </LedgerRow>
          ))}
        </Section>
      )}
      {result.duplicates.length > 0 && (
        <Section title={t("costs.check.duplicates")}>
          {result.duplicates.map((item) => (
            <LedgerRow key={item.row} className="py-2 [overflow-wrap:anywhere]">
              {item.name} <span className="text-ink-muted">({rowLabel(item.row)})</span>
            </LedgerRow>
          ))}
        </Section>
      )}
      {result.incomplete.length > 0 && (
        <Section title={t("costs.check.incomplete")}>
          {result.incomplete.map((item) => (
            <LedgerRow key={item.row} className="py-2 [overflow-wrap:anywhere]">
              {item.name} <span className="text-ink-muted">({rowLabel(item.row)})</span>
            </LedgerRow>
          ))}
        </Section>
      )}
      {result.invalid.length > 0 && (
        <Section title={t("costs.check.invalid")}>
          {result.invalid.map((item) => (
            <LedgerRow key={item.row} className="py-2">
              {rowLabel(item.row)}: {codeText(item.code)}
            </LedgerRow>
          ))}
        </Section>
      )}
    </div>
  );
}

/** Row errors of a refused sheet (422): the file row, the field and a reason in words, never a cell. */
export function CostCheckErrorList({
  details,
}: {
  details: { row?: string | number; field?: string | number; code?: string | number }[];
}) {
  return (
    <LedgerList>
      {details.map((detail, index) => (
        <LedgerRow key={index} className="py-2">
          {rowLabel(Number(detail.row ?? 0))}: {String(detail.field ?? "")} —{" "}
          {codeText(String(detail.code ?? ""))}
        </LedgerRow>
      ))}
    </LedgerList>
  );
}
