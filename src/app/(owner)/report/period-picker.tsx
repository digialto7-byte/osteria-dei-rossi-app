import { SegmentedControl } from "@/components/segmented-control";
import { Field, TextInput } from "@/components/ui";
import type { ReactNode } from "react";
import { t } from "@/lib/i18n";

export const PERIODI = ["giorno", "settimana", "mese", "periodo"] as const;
export type Periodo = (typeof PERIODI)[number];

const LABEL = {
  giorno: "report.period.day",
  settimana: "report.period.week",
  mese: "report.period.month",
  periodo: "report.period.custom",
} as const;

/** The one panel the period tabs control (WAI-ARIA tabs): the report content under the picker. */
export const PERIOD_PANEL_ID = "report-period-panel";
const periodTabId = (periodo: Periodo) => `report-period-${periodo}`;

/**
 * The report content under the PeriodPicker, as the tabpanel of its tabs: `aria-labelledby` is the selected period's tab. It is a real box
 * (so the role stays exposed) that must not change the look of the page: `gap-6` is PageMain's gap, `empty:-mt-6` cancels the page's gap
 * when there is nothing to show, and `data-reveal-through` makes globals.css give its children the rise-in and delays they had as direct
 * children of the page, continuing the page's delay sequence from the box's own place in it (the box itself plays no animation).
 */
export function PeriodPanel({ periodo, children }: { periodo: Periodo; children?: ReactNode }) {
  return (
    <div
      role="tabpanel"
      id={PERIOD_PANEL_ID}
      aria-labelledby={periodTabId(periodo)}
      data-reveal-through=""
      className="flex flex-col gap-6 empty:-mt-6"
    >
      {children}
    </div>
  );
}

export interface PeriodState {
  periodo: Periodo;
  data: string | null;
  dal: string | null;
  al: string | null;
}

/**
 * "Giorno · Settimana · Mese · Periodo" (the house SegmentedControl: one choice, the selected one in ink) and the date field(s) that go with the choice. It changes the address, not state: the page reads the
 * address, so the back button and a shared link give the same screen. `lastDay` is the venue's business date from the last report reply:
 * no field offers a later day (between 00:00 and 02:00 Rome the calendar date is a day that has not started). Until a reply has given it,
 * it is null and the fields set no limit of their own; the server still refuses a future day (date_in_future).
 */
export function PeriodPicker({
  state,
  lastDay,
  onChange,
}: {
  state: PeriodState;
  lastDay: string | null;
  onChange: (next: Partial<PeriodState> & { periodo: Periodo }) => void;
}) {
  const max = lastDay ?? undefined;
  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl
        label={t("report.period.label")}
        segments={PERIODI.map((periodo) => ({
          key: periodo,
          label: t(LABEL[periodo]),
          id: periodTabId(periodo),
          controls: PERIOD_PANEL_ID,
        }))}
        selected={state.periodo}
        onSelect={(periodo) => onChange({ periodo })}
      />
      {state.periodo === "periodo" ? (
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("report.picker.from")}>
            <TextInput
              type="date"
              max={max}
              value={state.dal ?? ""}
              onChange={(event) =>
                onChange({ periodo: "periodo", dal: event.target.value || null, al: state.al })
              }
            />
          </Field>
          <Field label={t("report.picker.to")}>
            <TextInput
              type="date"
              max={max}
              value={state.al ?? ""}
              onChange={(event) =>
                onChange({ periodo: "periodo", dal: state.dal, al: event.target.value || null })
              }
            />
          </Field>
        </div>
      ) : (
        <Field label={t("report.picker.date")}>
          <TextInput
            type="date"
            max={max}
            value={state.data ?? ""}
            onChange={(event) =>
              onChange({ periodo: state.periodo, data: event.target.value || null })
            }
          />
        </Field>
      )}
    </div>
  );
}
