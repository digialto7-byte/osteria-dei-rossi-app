import { Card, SubHeading } from "@/components/ui";
import {
  differenceFigure,
  differenceSentence,
  differenceTone,
} from "@/lib/day-close/day-close-view";
import { t, tn } from "@/lib/i18n";
import { formatTime } from "@/lib/time/format";
import type { AppVsRegister } from "@/server/day-close/output";

const TONE = {
  over: "text-warning",
  under: "text-danger",
  equal: "text-success",
} as const;

/**
 * The difference between the app and the register (app minus register, Q131), exactly as the database computed it: the signed figure and
 * its percentage, the sentence that carries the meaning (the colour only reinforces it), who entered the total and when, and how many
 * times it was corrected. Without a register entry it only asks for the total.
 */
export function DifferenceCard({
  register,
  difference,
}: {
  register: AppVsRegister["register"];
  difference: AppVsRegister["difference"];
}) {
  return (
    <Card className="flex flex-col gap-2">
      <SubHeading>{t("dayClose.diff.title")}</SubHeading>
      {register === null || difference === null ? (
        <p className="text-ink-muted">{t("dayClose.diff.none")}</p>
      ) : (
        <>
          <p
            data-tone={differenceTone(difference.amount)}
            className={`font-display text-3xl font-semibold tabular-nums ${TONE[differenceTone(difference.amount)]}`}
          >
            {differenceFigure(difference.amount, difference.pct)}
          </p>
          <p className="font-bold">{differenceSentence(difference.amount)}</p>
          <p className="text-sm text-ink-muted">
            {t("dayClose.diff.enteredBy", {
              name: register.enteredBy.displayName,
              time: formatTime(new Date(register.enteredAt)),
            })}
          </p>
          {register.entries > 1 && (
            <p className="text-sm text-ink-muted">
              {tn("dayClose.diff.entries", register.entries)}
            </p>
          )}
        </>
      )}
    </Card>
  );
}
