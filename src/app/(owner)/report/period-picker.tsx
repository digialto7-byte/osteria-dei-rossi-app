import { SegmentedControl } from "@/components/segmented-control";
import { Field, TextInput } from "@/components/ui";
import { t } from "@/lib/i18n";

export const PERIODI = ["giorno", "settimana", "mese", "periodo"] as const;
export type Periodo = (typeof PERIODI)[number];

const LABEL = {
  giorno: "report.period.day",
  settimana: "report.period.week",
  mese: "report.period.month",
  periodo: "report.period.custom",
} as const;

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
        segments={PERIODI.map((periodo) => ({ key: periodo, label: t(LABEL[periodo]) }))}
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
