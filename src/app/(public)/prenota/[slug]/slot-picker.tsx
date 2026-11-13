import type { Ref } from "react";
import { Button } from "@/components/ui";
import { t } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/locale";
import type { SlotsReply } from "@/server/reservations/public/output";

export interface Chosen {
  serviceKey: string;
  time: string;
}

/**
 * The services as tabs and the times of the active one as buttons: exactly what the slots reply lists, nothing computed here. A time the database says is taken is
 * shown disabled. No count of places is ever shown or known.
 */
export function SlotPicker({
  services,
  activeKey,
  chosen,
  locale,
  onTab,
  onPick,
  firstFreeRef,
}: {
  services: SlotsReply["services"];
  activeKey: string | undefined;
  chosen: Chosen | null;
  locale: Locale;
  onTab: (key: string) => void;
  onPick: (choice: Chosen) => void;
  /** Attached to the first time that can be picked, or to the open tab when only another service has one, so the form can move focus there. */
  firstFreeRef?: Ref<HTMLButtonElement>;
}) {
  const active = services.find((service) => service.key === activeKey);
  const firstFree = active?.slots.find((slot) => slot.available)?.time;
  // The open service is full but another has free times: the form's focus goes to the open tab, where the guest can switch. A free time of
  // another service has no button on screen to focus.
  const otherFree =
    firstFree === undefined && services.some((s) => s.slots.some((x) => x.available));
  return (
    <div className="flex flex-col gap-3">
      <div
        role="tablist"
        aria-label={t("publicReservation.services", {}, locale)}
        className="flex flex-wrap gap-2"
      >
        {services.map((service) => (
          <Button
            key={service.key}
            ref={otherFree && service.key === activeKey ? firstFreeRef : undefined}
            role="tab"
            variant={service.key === activeKey ? "primary" : "secondary"}
            aria-selected={service.key === activeKey}
            onClick={() => onTab(service.key)}
          >
            {service.name}
          </Button>
        ))}
      </div>
      <div
        role="group"
        aria-label={t("publicReservation.time", {}, locale)}
        className="grid grid-cols-3 gap-2"
      >
        {active?.slots.map((slot) => {
          const picked = chosen?.serviceKey === active.key && chosen.time === slot.time;
          return (
            <Button
              key={slot.time}
              ref={slot.time === firstFree ? firstFreeRef : undefined}
              variant={picked ? "primary" : "secondary"}
              disabled={!slot.available}
              aria-pressed={picked}
              aria-label={
                slot.available
                  ? undefined
                  : t("publicReservation.slotUnavailable", { time: slot.time }, locale)
              }
              onClick={() => onPick({ serviceKey: active.key, time: slot.time })}
            >
              {slot.time}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
