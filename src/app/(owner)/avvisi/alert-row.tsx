import { Badge, Button, LedgerRow } from "@/components/ui";
import { ackLine, alertMeta, severityView } from "@/lib/alerts/alert-view";
import { t } from "@/lib/i18n";
import type { AlertItem } from "@/server/alerts/list";

/** One alert: severity word, the rendered title and body, when, and "Ho visto" or who saw it. */
export function AlertRow({
  alert,
  busy,
  onAcknowledge,
}: {
  alert: AlertItem;
  busy: boolean;
  onAcknowledge: (id: string) => void;
}) {
  const severity = severityView(alert.severity);
  return (
    <LedgerRow className="flex flex-col gap-1.5 py-3">
      <Badge tone={severity.tone}>{severity.label}</Badge>
      <p className="font-bold [overflow-wrap:anywhere]">{alert.title}</p>
      <p className="[overflow-wrap:anywhere]">{alert.body}</p>
      <p className="num text-sm text-ink-muted">{alertMeta(alert.createdAt)}</p>
      {alert.acknowledged ? (
        <p className="num text-sm text-ink-muted">{ackLine(alert.acknowledged)}</p>
      ) : (
        <div>
          <Button variant="secondary" disabled={busy} onClick={() => onAcknowledge(alert.id)}>
            {t("alerts.ack.button")}
          </Button>
        </div>
      )}
    </LedgerRow>
  );
}
