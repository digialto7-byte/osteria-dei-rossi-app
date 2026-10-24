"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import {
  ErrorAlert,
  Heading,
  Muted,
  SuccessNote,
  linkClass,
  warningNoteClass,
} from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import { formatStockQty } from "@/lib/stock/stock-view";
import type { BatchLabel } from "@/server/batches/types";
import { negativesKey, type NegativeNote } from "../../negatives";
import { LabelText } from "./label-text";

const FORBIDDEN = 403;
const NOT_FOUND = 404;

/**
 * The label text of a batch, to copy by hand. Reads /api/batches/:id/label only. Right after a split (`?diviso=1`)
 * it says which new lot was made. Right after a production (`?nuovo=1`) it also confirms the lot code and says which locations the production left negative (the notes the
 * production page left in session storage, which stay there for this tab).
 */
export default function LabelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [label, setLabel] = useState<BatchLabel | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);
  const [wasSplit, setWasSplit] = useState(false);
  const [notes, setNotes] = useState<NegativeNote[]>([]);

  useEffect(() => {
    // Reading the address and the notes the production page left is the effect's job here.
    const query = new URLSearchParams(window.location.search);
    const isNew = query.get("nuovo") === "1";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFresh(isNew);
    setWasSplit(query.get("diviso") === "1");
    if (isNew) {
      const stored = window.sessionStorage.getItem(negativesKey(id));
      if (stored) {
        try {
          setNotes(JSON.parse(stored) as NegativeNote[]);
        } catch {
          setNotes([]);
        }
      }
    }
    void (async () => {
      const result = await apiJson<BatchLabel>(`/api/batches/${id}/label`);
      if (result.ok) return setLabel(result.data);
      if (result.status === FORBIDDEN) return setMessage(t("production.forbidden"));
      if (result.status === NOT_FOUND) return setMessage(t("production.label.notFound"));
      setMessage(result.error.message);
    })();
  }, [id]);

  return (
    <>
      {fresh && label && (
        <SuccessNote role="status">
          {t("production.label.saved", { code: label.lotCode })}
        </SuccessNote>
      )}
      {wasSplit && label && (
        <SuccessNote role="status">
          {t("production.label.split", { code: label.lotCode })}
        </SuccessNote>
      )}
      {fresh &&
        notes.map((note) => (
          <p key={`${note.ingredient}-${note.location}`} role="status" className={warningNoteClass}>
            {t("production.label.negative", {
              ingredient: note.ingredient,
              location: note.location,
              qty: formatStockQty(note.qty, note.unit),
            })}
          </p>
        ))}
      <Heading>{t("production.label.title")}</Heading>
      {label ? (
        <>
          <LabelText label={label} />
          <Muted>{t("production.label.note")}</Muted>
        </>
      ) : (
        <>
          <ErrorAlert message={message} />
          {!message && <Muted>{t("common.loading")}</Muted>}
        </>
      )}
      <Link href="/produzione" className={`${linkClass} self-start`}>
        ← {t("production.back")}
      </Link>
    </>
  );
}
