import Link from "next/link";
import { Badge, Button, LedgerList, LedgerRow, Muted, SubHeading } from "@/components/ui";
import { t } from "@/lib/i18n";
import { formatShortDate, lotCodeText, lotHref, lotMetaLine } from "@/lib/trace/trace-view";
import type { TraceLotSearch } from "@/server/trace/output";

/**
 * The deliveries a search found, newest first, each row a link to its lot page: the code (or "Lotto senza codice"), a badge with the expiry in words
 * and one meta line. A search by code that finds nothing offers the other filters.
 */
export function LotResults({
  result,
  byCode,
  onTryOther,
}: {
  result: TraceLotSearch;
  byCode: boolean;
  onTryOther: () => void;
}) {
  return (
    <section aria-live="polite" className="flex flex-col gap-2">
      <SubHeading>{t("trace.results")}</SubHeading>
      {result.lots.length === 0 ? (
        byCode ? (
          <>
            <Muted>{t("trace.noResult.code")}</Muted>
            <div>
              <Button variant="quiet" onClick={onTryOther}>
                {t("trace.tryOther")}
              </Button>
            </div>
          </>
        ) : (
          <Muted>{t("trace.noResult.other")}</Muted>
        )
      ) : (
        <LedgerList>
          {result.lots.map((lot) => (
            <LedgerRow key={lot.lotId}>
              <Link
                href={lotHref(lot.lotId)}
                className="flex min-h-tap flex-col justify-center gap-1 py-3"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="num font-bold [overflow-wrap:anywhere]">
                    {lotCodeText(lot.lotCode)}
                  </span>
                  {lot.expiry ? (
                    <Badge tone="neutral">
                      {t("trace.expires", { date: formatShortDate(lot.expiry) })}
                    </Badge>
                  ) : null}
                </span>
                <span className="num text-sm text-ink-muted [overflow-wrap:anywhere]">
                  {lotMetaLine(lot)}
                </span>
              </Link>
            </LedgerRow>
          ))}
        </LedgerList>
      )}
      {result.truncated ? (
        <Muted>{t("trace.truncated.lots", { count: result.lots.length })}</Muted>
      ) : null}
    </section>
  );
}
