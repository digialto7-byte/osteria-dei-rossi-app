"use client";

import { useEffect, useState } from "react";
import { ErrorAlert } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { t, tn } from "@/lib/i18n";
import type { ReservationsCovers } from "@/server/reservations/output";

const FORBIDDEN = 403;

/**
 * "Prenotati (confermati)" (P2-2 spec §7.2), under the expected covers of the forecast: per service, the covers and bookings that are confirmed for
 * the day. Reads /api/reservations/covers for the date it is given; the reply is counts only (never a name, a phone or an e-mail) for every role.
 * It sits on its own line beneath "Coperti attesi" so nobody adds the forecast to the bookings. A failed read is one alert here and the forecast
 * around it still shows.
 */
export function BookedCovers({ date }: { date: string }) {
  const [data, setData] = useState<ReservationsCovers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    // Reading the day's covers when the panel's day changes is the effect's job here.
    let live = true;
    void apiJson<ReservationsCovers>(`/api/reservations/covers?date=${date}`).then((result) => {
      if (!live) return;
      if (result.ok) {
        setError(null);
        return setData(result.data);
      }
      if (result.status === FORBIDDEN) return setHidden(true);
      setError(result.error.message);
    });
    return () => {
      live = false;
    };
  }, [date]);

  if (hidden) return null;
  if (error) return <ErrorAlert message={error} />;
  // Another day's counts are never shown under this day: wait for the reply of the day asked for.
  if (data === null || data.businessDate !== date) return null;
  const any = data.services.some((service) => service.reservations > 0 || service.covers > 0);
  return (
    <div className="flex flex-col gap-1">
      <p className="font-bold">{t("booked.title")}</p>
      {!any ? (
        <p className="text-ink-muted">{t("booked.empty")}</p>
      ) : (
        <ul className="flex flex-col">
          {data.services.map((service) => (
            <li key={service.key} className="num flex flex-wrap justify-between gap-x-4">
              <span>{service.name}</span>{" "}
              <span>
                {tn("booked.covers", service.covers)} ·{" "}
                {tn("booked.reservations", service.reservations)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
