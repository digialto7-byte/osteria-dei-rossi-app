import { Muted, SubHeading } from "@/components/ui";
import { headline, type RowView } from "@/lib/reservations/day-view";
import type { ReservationAction } from "@/server/reservations/constants";
import { t } from "@/lib/i18n";
import { ReservationRow } from "./reservation-row";

export interface DayServiceView {
  key: string;
  name: string;
  startsAt: string | null;
  endsAt: string | null;
  counts: { reservations: number; covers: number; pending: number };
  reservations: RowView[];
}

/**
 * The day by service: one section per service of the reply, headed with its name and "2 prenotazioni · 6 coperti · 1 da confermare" (the database's counts), then its
 * bookings by time. Presentational only: the actions on a row are the reply's `actions`, and a tap on one is handed to the page.
 */
export function DayView({
  services,
  busyId,
  errors,
  onAction,
}: {
  services: DayServiceView[];
  busyId: string | null;
  errors: Record<string, string>;
  onAction: (row: RowView, action: ReservationAction) => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      {services.map((service) => (
        <section key={service.key} aria-label={service.name} className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <SubHeading>{service.name}</SubHeading>
            <p data-service-headline className="num text-ink-muted">
              {headline(service.counts)}
            </p>
          </div>
          {service.reservations.length === 0 ? (
            <Muted>{t("reservations.empty")}</Muted>
          ) : (
            service.reservations.map((row) => (
              <ReservationRow
                key={row.id}
                row={row}
                busy={busyId === row.id}
                error={errors[row.id] ?? null}
                onAction={(action) => onAction(row, action)}
              />
            ))
          )}
        </section>
      ))}
    </div>
  );
}
