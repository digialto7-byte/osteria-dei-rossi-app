import { t, type MessageKey } from "@/lib/i18n";
import { isConsoleDown, type ConsoleFailure } from "./console-api";

/**
 * The sentence a screen shows for a failed read: the console does not answer, the account has no access, or `readErrorKey` (the read's own
 * «Non riesco a leggere …»). The server's text is not shown: the codes decide the wording.
 */
export function failureMessage(failure: ConsoleFailure, readErrorKey: MessageKey): string {
  if (isConsoleDown(failure) || failure.error.code === "console_unavailable")
    return t("console.unavailable");
  if (failure.status === 403 && failure.error.code === "forbidden") return t("console.noAccess");
  return t(readErrorKey);
}
