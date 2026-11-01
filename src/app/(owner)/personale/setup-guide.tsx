"use client";

import { useState } from "react";
import { Badge, Button, Card, SubHeading, warningNoteClass } from "@/components/ui";
import { t } from "@/lib/i18n";
import type { SetupGuide as Guide } from "@/lib/staff-auth/setup-guide";

/**
 * "Come far entrare il personale": four steps for the owner (M25a). The steps, their state and whether the guide folds
 * away are decided by src/lib/staff-auth/setup-guide.ts; this only draws them.
 */
export function SetupGuide({ guide }: { guide: Guide }) {
  const [shown, setShown] = useState(false);
  const expanded = !guide.collapsed || shown;

  return (
    <div className="flex flex-col gap-3">
      {guide.collapsed && (
        <Button
          variant="quiet"
          aria-expanded={shown}
          onClick={() => setShown((value) => !value)}
          className="self-start"
        >
          {t("guide.toggle")}
        </Button>
      )}
      {expanded && (
        <Card className="flex flex-col gap-4">
          <SubHeading>{t("guide.title")}</SubHeading>
          {guide.warning && (
            <p className={warningNoteClass}>{t(`guide.warning.${guide.warning}`)}</p>
          )}
          <ol className="flex flex-col gap-4">
            {guide.steps.map((step) => (
              <li key={step.number} className="flex flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">
                    {step.number}. {t(step.titleKey)}
                  </span>
                  {step.state && (
                    <Badge tone={step.state === "done" ? "success" : "neutral"}>
                      {t(step.state === "done" ? "today.step.done" : "today.step.todo")}
                    </Badge>
                  )}
                </span>
                <span className="text-ink-muted">{t(step.bodyKey)}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
