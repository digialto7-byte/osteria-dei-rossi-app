"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorAlert, Heading, linkClass, Muted, warningNoteClass } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { parseCountInput } from "@/lib/counts/count-view";
import { t, tn } from "@/lib/i18n";
import { formatTime } from "@/lib/time/format";
import type {
  CloseResult,
  CountLine,
  CountLineEntry,
  CountSessionDetail,
} from "@/server/counts/types";
import { CloseCount } from "./close-count";
import { CountLineRow, type LineState } from "./count-line-row";

const FORBIDDEN = 403;
const NOT_FOUND = 404;

/** Shows a quantity in a field the way the chef types it: a comma, no trailing zeros. */
const asText = (qty: number | null) => (qty === null ? "" : String(qty).replace(".", ","));

/**
 * The quick count. Reads /api/counts/:id; leaving an input saves that line (PUT .../lines), Enter moves to the next
 * input, "Chiudi conteggio" posts the differences. The expected quantity, each difference and every counter are the
 * server's answers: this page types numbers in and shows what comes back.
 */
export default function CountPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<CountSessionDetail | null>(null);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [states, setStates] = useState<Record<string, LineState>>({});
  const [closed, setClosed] = useState<{ linesWithDifference: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<"forbidden" | "missing" | null>(null);
  const saved = useRef<Record<string, string>>({});
  const list = useRef<HTMLUListElement | null>(null);

  const load = useCallback(
    async (initial: boolean) => {
      const result = await apiJson<CountSessionDetail>(`/api/counts/${id}`);
      if (!result.ok) {
        if (result.status === FORBIDDEN) setProblem("forbidden");
        else if (result.status === NOT_FOUND) setProblem("missing");
        else setError(result.error.message);
        return;
      }
      setDetail(result.data);
      if (initial) {
        const initialTexts = Object.fromEntries(
          result.data.lines.map((line) => [line.ingredientId, asText(line.countedQty)]),
        );
        saved.current = { ...initialTexts };
        setTexts(initialTexts);
      }
    },
    [id],
  );

  useEffect(() => {
    // Loading the count when the page opens is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(true);
  }, [load]);

  function mergeEntry(entry: CountLineEntry) {
    setDetail((current) =>
      current
        ? {
            ...current,
            lines: current.lines.map((line) =>
              line.ingredientId === entry.ingredientId
                ? {
                    ...line,
                    expectedQty: entry.expectedQty,
                    countedQty: entry.countedQty,
                    differenceQty: entry.differenceQty,
                    enteredAt: entry.enteredAt,
                  }
                : line,
            ),
          }
        : current,
    );
  }

  async function saveLine(line: CountLine) {
    const text = texts[line.ingredientId] ?? "";
    if (text === saved.current[line.ingredientId]) return;
    const parsed = parseCountInput(text);
    if (parsed.kind === "invalid") {
      return setStates((current) => ({ ...current, [line.ingredientId]: "error" }));
    }
    setStates((current) => ({ ...current, [line.ingredientId]: "saving" }));
    const result = await apiJson<{ lines: CountLineEntry[] }>(`/api/counts/${id}/lines`, {
      method: "PUT",
      body: {
        lines: [
          {
            ingredientId: line.ingredientId,
            qty: parsed.kind === "qty" ? parsed.value : null,
            unit: line.baseUnit,
          },
        ],
      },
    });
    if (!result.ok) {
      setError(result.error.message);
      return setStates((current) => ({ ...current, [line.ingredientId]: "error" }));
    }
    setError(null);
    saved.current[line.ingredientId] = text;
    mergeEntry(result.data.lines[0]!);
    setStates((current) => ({ ...current, [line.ingredientId]: "saved" }));
    // The progress and the number of differences are the server's: ask again instead of counting here.
    void load(false);
  }

  function focusNext(index: number) {
    const inputs = list.current?.querySelectorAll<HTMLInputElement>("input");
    inputs?.[index + 1]?.focus();
  }

  async function close() {
    setBusy(true);
    const result = await apiJson<CloseResult>(`/api/counts/${id}/close`, {
      method: "POST",
      body: {},
    });
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    setError(null);
    setClosed({ linesWithDifference: result.data.linesWithDifference });
  }

  async function cancel() {
    setBusy(true);
    const result = await apiJson(`/api/counts/${id}/cancel`, { method: "POST", body: {} });
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    router.push("/magazzino/conteggi");
  }

  if (problem) {
    return (
      <>
        <Heading>{t("count.title")}</Heading>
        <ErrorAlert message={t(problem === "forbidden" ? "count.forbidden" : "count.notFound")} />
        <Link href="/magazzino/conteggi" className={`${linkClass} self-start`}>
          ← {t("count.back")}
        </Link>
      </>
    );
  }
  if (detail === null) {
    return (
      <>
        <Heading>{t("count.title")}</Heading>
        <ErrorAlert message={error} />
        {!error && <Muted>{t("common.loading")}</Muted>}
      </>
    );
  }

  const isOpen = detail.status === "open" && !closed;
  return (
    <>
      <Heading>{t(`count.start.${detail.type}`)}</Heading>
      <p className="num text-ink-muted">
        {t("count.page.meta", {
          location: detail.location.name,
          time: formatTime(new Date(detail.startedAt)),
        })}
      </p>
      {isOpen && detail.invoicesAwaitingApproval > 0 && (
        <p className={warningNoteClass}>
          {tn("count.page.pendingInvoices", detail.invoicesAwaitingApproval)}
        </p>
      )}
      <ErrorAlert message={error} />
      {!isOpen && !closed && (
        <Muted>
          {t(detail.status === "closed" ? "count.page.closedNote" : "count.page.cancelledNote")}
        </Muted>
      )}
      <ul ref={list} className="ledger flex flex-col border-y border-rule">
        {detail.lines.map((line, index) =>
          isOpen ? (
            <CountLineRow
              key={line.ingredientId}
              line={line}
              text={texts[line.ingredientId] ?? ""}
              state={states[line.ingredientId] ?? "idle"}
              onText={(value) => {
                setTexts((current) => ({ ...current, [line.ingredientId]: value }));
                setStates((current) => ({ ...current, [line.ingredientId]: "idle" }));
              }}
              onLeave={() => void saveLine(line)}
              onEnter={() => focusNext(index)}
            />
          ) : null,
        )}
      </ul>
      {detail.status === "open" ? (
        <CloseCount
          sessionId={detail.id}
          linesCounted={detail.linesCounted}
          linesTotal={detail.linesTotal}
          linesWithDifference={detail.linesWithDifference}
          busy={busy}
          closed={closed}
          onClose={() => void close()}
          onCancel={() => void cancel()}
        />
      ) : (
        detail.status === "closed" && (
          <Link
            href={`/magazzino/conteggi/${detail.id}/scostamenti`}
            className={`${linkClass} self-start`}
          >
            {t("count.row.variance")}
          </Link>
        )
      )}
      <Link href="/magazzino/conteggi" className={`${linkClass} self-start`}>
        ← {t("count.back")}
      </Link>
    </>
  );
}
