"use client";

import { useState } from "react";
import { Button, Card, Checkbox, SubHeading, SuccessNote } from "@/components/ui";
import { t } from "@/lib/i18n";

export type TestAlertResult = "created" | "deduplicated" | null;

/** The owner's "check that alerts work" card. One secondary button: the page has no primary action. */
export function TestAlertCard({
  busy,
  result,
  onSend,
}: {
  busy: boolean;
  result: TestAlertResult;
  onSend: (includeKitchen: boolean) => void;
}) {
  const [includeKitchen, setIncludeKitchen] = useState(false);
  return (
    <Card className="flex flex-col gap-3">
      <SubHeading>{t("alerts.test.title")}</SubHeading>
      <p className="text-ink-muted">{t("alerts.test.hint")}</p>
      <Checkbox
        label={t("alerts.test.kitchen")}
        checked={includeKitchen}
        onChange={(event) => setIncludeKitchen(event.target.checked)}
      />
      <div>
        <Button variant="secondary" disabled={busy} onClick={() => onSend(includeKitchen)}>
          {t("alerts.test.send")}
        </Button>
      </div>
      {result && (
        <SuccessNote role="status">
          {t(result === "created" ? "alerts.test.created" : "alerts.test.deduplicated")}
        </SuccessNote>
      )}
    </Card>
  );
}
