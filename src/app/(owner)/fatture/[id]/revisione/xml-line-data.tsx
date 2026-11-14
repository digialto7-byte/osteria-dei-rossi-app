"use client";

import { useRef, useState } from "react";
import { Button, ErrorAlert } from "@/components/ui";
import { t } from "@/lib/i18n";
import {
  lineCodeText,
  lineDiscountText,
  lineKindText,
  otherDataValues,
  shownDate,
  type OtherDataValue,
} from "@/lib/invoices/xml-review-view";
import type { ReviewLine } from "@/server/invoices/review-types";
import type { LineActions } from "./actions";

/** What the file said about a line, under its usual row: kind, first code, price before discounts, then "Dal fornitore". */
export function XmlLineData({
  line,
  codeHint,
  saveLine,
}: {
  line: ReviewLine;
  /** The hint "usato per riconoscere l'articolo" shows once on the page, under the first code. */
  codeHint: boolean;
  /** Absent on a read-only invoice: the values are shown, with no button. */
  saveLine?: LineActions["saveLine"];
}) {
  const xml = line.xml;
  if (!xml) return null;
  const kind = lineKindText(line);
  const code = lineCodeText(xml);
  const discount = lineDiscountText(xml);
  const values = otherDataValues(xml);
  return (
    <>
      {kind && <p className="text-sm text-ink-muted">{kind}</p>}
      {code && (
        <p className="num text-sm [overflow-wrap:anywhere] text-ink-muted">
          {code}
          {codeHint && (
            <span className="block font-sans text-ink-muted">{t("review.xml.codeHint")}</span>
          )}
        </p>
      )}
      {discount && (
        <p className="num text-sm [overflow-wrap:anywhere] text-ink-muted">{discount}</p>
      )}
      {values.length > 0 && (
        <div className="flex w-full flex-col gap-2 rounded-lg bg-sunk p-3">
          <p className="font-bold">{t("review.xml.otherTitle")}</p>
          <ul className="flex flex-col gap-3">
            {values.map((value) => (
              <OtherDataRow key={value.key} line={line} value={value} saveLine={saveLine} />
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/**
 * One value the supplier wrote, with its own label (Costì does not interpret it). A text can be copied to the lot and a date to the
 * expiry in one tap; the tap sends exactly that field to the line and the screen reads the review again. A line that already has a
 * different value shows it and offers to replace it.
 */
function OtherDataRow({
  line,
  value,
  saveLine,
}: {
  line: ReviewLine;
  value: OtherDataValue;
  saveLine?: LineActions["saveLine"];
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const { use } = value;

  const current = use?.kind === "lot" ? line.lotCode : use?.kind === "expiry" ? line.expiry : null;
  const done = copied || (use !== null && current === use.value);

  async function copy() {
    if (!use || !saveLine || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const failure = await saveLine(
        line.id,
        use.kind === "lot" ? { lotCode: use.value } : { expiry: use.value },
      );
      if (failure) setError(failure);
      else setCopied(true);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const lot = use?.kind === "lot";
  return (
    <li className="flex flex-col items-start gap-1.5">
      <p className="[overflow-wrap:anywhere]">
        <span className="mr-2 text-sm font-bold text-ink-muted">{value.label}</span>
        <span className="num">{value.display}</span>
      </p>
      {value.tooLong && <p className="text-sm text-ink-muted">{t("review.xml.lotTooLong")}</p>}
      {use && done && (
        <p role="status" className="text-sm font-bold">
          {t(lot ? "review.xml.lotCopied" : "review.xml.expiryCopied")}
        </p>
      )}
      {use && !done && current !== null && (
        <p className="num text-sm text-ink-muted">
          {t(lot ? "review.xml.currentLot" : "review.xml.currentExpiry", {
            value: lot ? current : shownDate(current),
          })}
        </p>
      )}
      {use && !done && saveLine && (
        <Button variant="secondary" disabled={busy} aria-busy={busy} onClick={() => void copy()}>
          {busy
            ? t("review.xml.saving")
            : t(
                lot
                  ? current === null
                    ? "review.xml.useLot"
                    : "review.xml.replaceLot"
                  : current === null
                    ? "review.xml.useExpiry"
                    : "review.xml.replaceExpiry",
              )}
        </Button>
      )}
      <ErrorAlert message={error} />
    </li>
  );
}
