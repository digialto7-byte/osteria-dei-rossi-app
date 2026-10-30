import { Button, warningNoteClass } from "@/components/ui";
import { t } from "@/lib/i18n";
import type { Notice } from "@/lib/sync/notices";

/**
 * What the server decided about operations queued on this phone: one alert per unseen conflict, refusal, dropped operation or
 * overwritten line (M20 plan §3.6.5), each ending with "Ho capito" (44 px). The text is a plain string from src/lib/sync/notices.ts,
 * rendered as text: a note or a dish name with markup in it stays text. On the comanda the list is that session's; on the table list, all.
 */
export function SyncNotices({
  notices,
  onDismiss,
}: {
  notices: Notice[];
  onDismiss: (notice: Notice) => void;
}) {
  if (notices.length === 0) return null;
  return (
    <ul data-slot="sync-notices" className="flex flex-col gap-2">
      {notices.map((notice) => (
        <li
          key={notice.id}
          role="alert"
          data-op-id={notice.opIds[0]}
          data-notice-kind={notice.kind}
          className={`${warningNoteClass} flex flex-col items-start gap-2`}
        >
          <span>{notice.text}</span>
          <Button variant="secondary" onClick={() => onDismiss(notice)}>
            {t("sync.notice.dismiss")}
          </Button>
        </li>
      ))}
    </ul>
  );
}
