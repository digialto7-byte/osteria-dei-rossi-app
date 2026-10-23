import { Badge, Button, LedgerRow } from "@/components/ui";
import { t } from "@/lib/i18n";
import {
  deviceActions,
  deviceMeta,
  deviceStatusView,
  revokeConfirmText,
} from "@/lib/staff-auth/device-view";
import type { DeviceView } from "@/server/staff-auth/types";

/**
 * One enrolled device: its label, a status word, when it was enabled and last used (the device's own use,
 * never a person's), and "Sblocca" (locked only) and "Revoca". Revoking asks once, naming the device.
 */
export function DeviceRow({
  device,
  confirming,
  busy,
  onUnlock,
  onAskRevoke,
  onConfirmRevoke,
  onCancelRevoke,
}: {
  device: DeviceView;
  confirming: boolean;
  busy: boolean;
  onUnlock: (device: DeviceView) => void;
  onAskRevoke: (device: DeviceView) => void;
  onConfirmRevoke: (device: DeviceView) => void;
  onCancelRevoke: () => void;
}) {
  const nameId = `device-${device.id}-name`;
  const status = deviceStatusView(device.status);
  const actions = deviceActions(device.status);
  return (
    <LedgerRow className="flex flex-col gap-2 py-3">
      <div className="flex items-start justify-between gap-3">
        <span id={nameId} className="font-bold [overflow-wrap:anywhere]">
          {device.label}
        </span>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <p className="num text-sm text-ink-muted">{deviceMeta(device)}</p>
      {confirming ? (
        <div role="alertdialog" aria-labelledby={nameId} className="flex flex-col gap-2">
          <p>{revokeConfirmText(device.label)}</p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => onConfirmRevoke(device)}>
              {t("devices.revoke")}
            </Button>
            <Button variant="quiet" onClick={onCancelRevoke}>
              {t("devices.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {actions.unlock && (
            <Button
              variant="secondary"
              disabled={busy}
              aria-describedby={nameId}
              onClick={() => onUnlock(device)}
            >
              {t("devices.unlock")}
            </Button>
          )}
          {actions.revoke && (
            <Button
              variant="secondary"
              disabled={busy}
              aria-describedby={nameId}
              onClick={() => onAskRevoke(device)}
            >
              {t("devices.revoke")}
            </Button>
          )}
        </div>
      )}
    </LedgerRow>
  );
}
