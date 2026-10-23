"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Card, ErrorAlert, Field, Select } from "@/components/ui";
import { countTypeWord } from "@/lib/counts/count-view";
import { t } from "@/lib/i18n";
import type { CountSession, CountType } from "@/server/counts/types";

const primaryLink =
  "inline-flex min-h-tap min-w-tap items-center justify-center rounded-lg bg-accent px-4 text-base " +
  "font-bold text-on-accent hover:bg-accent-hover";

/**
 * The top of the count list. With a count in progress: one card with its progress and "Riprendi". Otherwise the
 * primary "Conteggio giornaliero", the secondary "Conteggio mensile" and, with two or more locations, a location
 * field. It only forwards what was chosen; the sessions, the lines and every rule are the server's.
 */
export function StartCount({
  openSession,
  locations,
  busy,
  error = null,
  onStart,
}: {
  openSession: CountSession | null;
  locations: readonly { id: string; name: string }[];
  busy: boolean;
  error?: string | null;
  onStart: (type: CountType, locationId: string | null) => void;
}) {
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const several = locations.length >= 2;
  const chosen = several && locationId ? locationId : null;

  if (openSession) {
    return (
      <Card className="flex flex-col gap-3">
        <p className="font-bold">{t("count.inProgress")}</p>
        <p className="num">
          {t("count.inProgress.line", {
            type: countTypeWord(openSession.type),
            location: openSession.location.name,
            counted: openSession.linesCounted,
            total: openSession.linesTotal,
          })}
        </p>
        <div>
          <Link href={`/magazzino/conteggi/${openSession.id}`} className={primaryLink}>
            {t("count.resume")}
          </Link>
        </div>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {several && (
        <Field label={t("count.location.label")}>
          <Select
            name="location"
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
          >
            {locations.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <div className="flex flex-wrap gap-3">
        <Button disabled={busy} onClick={() => onStart("daily", chosen)}>
          {t("count.start.daily")}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => onStart("monthly", chosen)}>
          {t("count.start.monthly")}
        </Button>
      </div>
      <ErrorAlert message={error} />
    </div>
  );
}
