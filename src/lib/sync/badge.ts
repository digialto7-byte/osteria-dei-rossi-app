import { t, tn } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import type { SyncView } from "./view";

// The words of the pending-operations badge (M20 plan §3.6.5): "In coda · 3", its accessible name and the state word. Pure; the
// component only renders them. `now` is passed in so the countdown is testable.

export interface BadgeParts {
  label: string;
  aria: string;
  stateWord: string | null;
}

export function badgeParts(
  view: SyncView,
  now: number,
  locale: Locale = DEFAULT_LOCALE,
): BadgeParts | null {
  if (!view.visible) return null;
  const waiting = view.pending > 0;
  const count = waiting ? view.pending : view.unseen;
  return {
    label: t(waiting ? "sync.badge.label" : "sync.badge.notices", { count }, locale),
    aria: tn(waiting ? "sync.badge.aria" : "sync.badge.noticesAria", count, locale),
    stateWord: stateWord(view, now, locale),
  };
}

function stateWord(view: SyncView, now: number, locale: Locale): string | null {
  switch (view.state) {
    case "sending":
      return t("sync.state.sending", {}, locale);
    case "offline":
      return t("sync.state.offline", {}, locale);
    case "backoff":
      if (view.nextAttemptAt === null) return null;
      return t(
        "sync.state.retry",
        { seconds: Math.max(1, Math.ceil((view.nextAttemptAt - now) / 1_000)) },
        locale,
      );
    default:
      return null;
  }
}
