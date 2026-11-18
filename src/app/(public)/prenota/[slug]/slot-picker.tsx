import { useId, type Ref } from "react";
import { SegmentedControl } from "@/components/segmented-control";
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
  const id = useId();
  const panelId = `${id}-panel`;
  const active = services.find((service) => service.key === activeKey);
  const firstFree = active?.slots.find((slot) => slot.available)?.time;
  // The open service is full but another has free times: the form's focus goes to the open tab, where the guest can switch. A free time of
  // another service has no button on screen to focus.
  const otherFree =
    firstFree === undefined && services.some((s) => s.slots.some((x) => x.available));
  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl
        label={t("publicReservation.services", {}, locale)}
        segments={services.map((service) => ({
          key: service.key,
          label: service.name,
          id: `${id}-tab-${service.key}`,
          controls: panelId,
        }))}
        selected={activeKey ?? ""}
        onSelect={onTab}
        selectedRef={otherFree ? firstFreeRef : undefined}
      />
      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={activeKey === undefined ? undefined : `${id}-tab-${activeKey}`}
      >
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
                variant={picked ? "selected" : "secondary"}
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
    </div>
  );
}
