import Link from "next/link";
import { linkClass } from "@/components/ui";
import type { EmptyContent } from "@/lib/empty/empty-content";
import { t } from "@/lib/i18n";

/**
 * The empty list of a screen: one line of text and, when there is a sensible next step for this role, one link after
 * it. What to say and offer is chosen in src/lib/empty/empty-content.ts.
 */
export function EmptyState({ messageKey, action }: EmptyContent) {
  return (
    <div className="flex flex-col items-start gap-1">
      <p className="text-ink-muted">{t(messageKey)}</p>
      {action && (
        <Link href={action.href} className={linkClass}>
          {t(action.labelKey)}
        </Link>
      )}
    </div>
  );
}
