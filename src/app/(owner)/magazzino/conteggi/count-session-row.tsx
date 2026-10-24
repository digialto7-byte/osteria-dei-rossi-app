import Link from "next/link";
import { Badge, LedgerRow, linkClass } from "@/components/ui";
import { countStatusView, countTypeWord } from "@/lib/counts/count-view";
import { t, tn } from "@/lib/i18n";
import { formatDateTime } from "@/lib/time/format";
import type { CountSession } from "@/server/counts/types";

/**
 * One count of the list: the type word and the location, a status badge with a word, the Europe/Rome start and who
 * started it ("tu", the colleague's name, or "un collega" when the server hides it), and, once closed, how many
 * differences it recorded with a link to the variance. Quantities only, never money; the counters are the server's.
 */
export function CountSessionRow({ session }: { session: CountSession }) {
  const status = countStatusView(session.status);
  const who = session.startedBy.me
    ? t("count.by.me")
    : (session.startedBy.name ?? t("count.by.colleague"));
  return (
    <LedgerRow className="flex flex-col gap-1.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={status.tone}>{status.label}</Badge>
        <span className="font-bold [overflow-wrap:anywhere]">
          {countTypeWord(session.type)} · {session.location.name}
        </span>
      </div>
      <p className="num text-sm text-ink-muted">
        {formatDateTime(new Date(session.startedAt))} · {who}
      </p>
      {session.status === "closed" ? (
        <>
          <p className="num text-sm">{tn("count.row.differences", session.linesWithDifference)}</p>
          <Link
            href={`/magazzino/conteggi/${session.id}/scostamenti`}
            className={`${linkClass} self-start`}
          >
            {t("count.row.variance")}
          </Link>
        </>
      ) : session.status === "open" ? (
        <p className="num text-sm">
          {t("count.row.progress", { counted: session.linesCounted, total: session.linesTotal })}
        </p>
      ) : null}
    </LedgerRow>
  );
}
