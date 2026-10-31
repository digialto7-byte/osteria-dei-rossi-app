import { Button, Field, TextInput } from "@/components/ui";
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
 * "Giorno · Settimana · Mese · Periodo" and the date field(s) that go with the choice. It changes the address, not state: the page reads the
 * address, so the back button and a shared link give the same screen.
 */
export function PeriodPicker({
  state,
  onChange,
}: {
  state: PeriodState;
  onChange: (next: Partial<PeriodState> & { periodo: Periodo }) => void;
}) {
  return (
    <div className="flex flex-col gap-3" role="group" aria-label={t("report.period.label")}>
      <div className="flex flex-wrap gap-2">
        {PERIODI.map((periodo) => (
          <Button
            key={periodo}
            variant={state.periodo === periodo ? "primary" : "secondary"}
            aria-pressed={state.periodo === periodo}
            onClick={() => onChange({ periodo })}
          >
            {t(LABEL[periodo])}
          </Button>
        ))}
      </div>
      {state.periodo === "periodo" ? (
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("report.picker.from")}>
            <TextInput
              type="date"
              value={state.dal ?? ""}
              onChange={(event) =>
                onChange({ periodo: "periodo", dal: event.target.value || null, al: state.al })
              }
            />
          </Field>
          <Field label={t("report.picker.to")}>
            <TextInput
              type="date"
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
