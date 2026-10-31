"use client";

import { Button, ErrorAlert, warningNoteClass } from "@/components/ui";
import { groupLabel, lineLabel, partLabel } from "@/lib/bill/bill-view";
import {
  addGroup,
  assignLine,
  groupOf,
  selectGroup,
  setGroupCovers,
  type SplitForm,
} from "@/lib/bill/split-form";
import { t, tn } from "@/lib/i18n";
import { formatEuro } from "@/lib/money/format";
import { MAX_SPLIT_GROUPS, MAX_SPLIT_PARTS, MIN_SPLIT_PARTS } from "@/server/bill/constants";
import type { BillLine, BillOutput } from "@/server/bill/output";

export type SplitMode = "covers" | "items";

const CHIP = "min-h-tap rounded-lg px-3 text-base font-bold transition-colors duration-150 ";

/**
 * "Dividi il conto" (M21 plan §3.6). By covers: a stepper for the number of parts; by dishes: bills as chips, a tap on a line puts it on
 * the selected bill ("Da dividere" shares it), and "Calcola" asks the server. The panel keeps only ids and counts (split-form.ts); every
 * amount shown here came from the server's reply, by part index. Nothing is added, divided or rounded in this file.
 */
export function SplitPanel({
  mode,
  onMode,
  lines,
  covers,
  parts,
  onParts,
  split,
  form,
  onForm,
  onCalculate,
  busy,
  error,
  stale = false,
}: {
  mode: SplitMode;
  onMode: (mode: SplitMode) => void;
  lines: readonly BillLine[];
  covers: number;
  parts: number;
  onParts: (parts: number) => void;
  split: BillOutput["split"];
  form: SplitForm;
  onForm: (form: SplitForm) => void;
  onCalculate: () => void;
  busy: boolean;
  error: string | null;
  /** The bill changed after the shares were computed: they are not shown and need "Calcola" again. */
  stale?: boolean;
}) {
  const assignmentOf = (lineId: string) => {
    const where = groupOf(form, lineId);
    if (where === "shared") return t("bill.split.shared");
    return where === null ? t("bill.split.unassigned") : groupLabel(where + 1);
  };
  return (
    <section className="flex flex-col gap-4 rounded-card border border-rule bg-surface p-4">
      <h3 className="font-display text-xl font-semibold">{t("bill.split.title")}</h3>
      <div className="flex flex-wrap gap-2">
        {(["covers", "items"] as const).map((value) => (
          <Button
            key={value}
            variant={mode === value ? "primary" : "secondary"}
            aria-pressed={mode === value}
            onClick={() => onMode(value)}
          >
            {t(value === "covers" ? "bill.split.byCovers" : "bill.split.byItems")}
          </Button>
        ))}
      </div>

      {mode === "covers" ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              aria-label={t("bill.split.fewerParts")}
              disabled={parts <= MIN_SPLIT_PARTS}
              onClick={() => onParts(parts - 1)}
            >
              −
            </Button>
            <output
              aria-label={t("bill.split.parts")}
              className="min-w-10 text-center text-xl font-bold tabular-nums"
            >
              {parts}
            </output>
            <Button
              variant="secondary"
              aria-label={t("bill.split.moreParts")}
              disabled={parts >= MAX_SPLIT_PARTS}
              onClick={() => onParts(parts + 1)}
            >
              +
            </Button>
          </div>
          {split?.mode === "covers" && (
            <ul className="flex flex-col gap-1">
              {split.parts.map((part) => (
                <li
                  key={part.index}
                  data-part-index={part.index}
                  className="flex items-center justify-between gap-2 font-bold tabular-nums"
                >
                  {`${partLabel(part.index)} · ${formatEuro(part.amount)}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {form.groups.map((_group, index) => (
              <button
                key={index}
                type="button"
                aria-pressed={form.selected === index}
                onClick={() => onForm(selectGroup(form, index))}
                className={
                  CHIP +
                  (form.selected === index
                    ? "bg-accent text-on-accent"
                    : "border border-rule-strong bg-surface text-ink hover:bg-sunk")
                }
              >
                {groupLabel(index + 1)}
              </button>
            ))}
            {form.groups.length < MAX_SPLIT_GROUPS && (
              <button
                type="button"
                onClick={() => onForm(addGroup(form))}
                className={
                  CHIP + "border border-dashed border-rule-strong bg-surface text-ink hover:bg-sunk"
                }
              >
                {t("bill.split.addGroup")}
              </button>
            )}
            <button
              type="button"
              aria-pressed={form.selected === "shared"}
              onClick={() => onForm(selectGroup(form, "shared"))}
              className={
                CHIP +
                (form.selected === "shared"
                  ? "bg-accent text-on-accent"
                  : "border border-rule-strong bg-surface text-ink hover:bg-sunk")
              }
            >
              {t("bill.split.shared")}
            </button>
          </div>

          <ul className="flex flex-col divide-y divide-rule rounded-lg border border-rule">
            {lines.map((line) => (
              <li key={line.id} data-line-id={line.id}>
                <button
                  type="button"
                  onClick={() => onForm(assignLine(form, line.id, form.selected))}
                  className="flex min-h-tap w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left hover:bg-sunk"
                >
                  <span>{lineLabel(line)}</span>
                  <span className="text-sm font-bold text-accent-ink">{assignmentOf(line.id)}</span>
                </button>
              </li>
            ))}
          </ul>

          <ul className="flex flex-col gap-2">
            {form.groups.map((group, index) => {
              const name = groupLabel(index + 1);
              return (
                <li key={index} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold">{name}</span>
                  <span className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      aria-label={t("bill.split.fewerCovers", { name })}
                      disabled={group.covers <= 0}
                      onClick={() => onForm(setGroupCovers(form, index, group.covers - 1))}
                    >
                      −
                    </Button>
                    <output
                      aria-label={tn("bill.split.covers", group.covers)}
                      className="min-w-16 text-center tabular-nums"
                    >
                      {tn("bill.split.covers", group.covers)}
                    </output>
                    <Button
                      variant="secondary"
                      aria-label={t("bill.split.moreCovers", { name })}
                      disabled={group.covers >= covers}
                      onClick={() => onForm(setGroupCovers(form, index, group.covers + 1))}
                    >
                      +
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>

          <Button disabled={busy} onClick={onCalculate}>
            {t("bill.split.compute")}
          </Button>

          {split?.mode === "items" && (
            <ul className="flex flex-col gap-1">
              {split.parts.map((part) => (
                <li
                  key={part.index}
                  data-part-index={part.index}
                  className="flex items-center justify-between gap-2 font-bold tabular-nums"
                >
                  {`${groupLabel(part.index)} · ${formatEuro(part.amount)}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {stale && (
        <p role="status" className={warningNoteClass}>
          {t("bill.split.stale")}
        </p>
      )}
      <ErrorAlert message={error} />
    </section>
  );
}
