import { t } from "@/lib/i18n";
import type { ConsoleFailure } from "./console-api";
import { failureMessage } from "./failure-message";

/** The sentence for a failed «Entra nel locale»: DigiAlto not attached, or the console's usual failure sentences. */
export function enterVenueMessage(failure: ConsoleFailure): string {
  if (failure.status === 409 && failure.error.code === "digialto_not_attached") {
    return t("console.detail.health.notAttached");
  }
  return failureMessage(failure, "console.enter.error");
}

/** The URL the server answered, only when it is an http(s) URL of the venue app's chooser: anything else (javascript:, data:, another page) is never opened. */
export function safeVenueUrl(value: string): string | null {
  const url = URL.parse(value);
  if (url === null || (url.protocol !== "https:" && url.protocol !== "http:")) return null;
  return url.pathname === "/login/scegli-locale" ? url.toString() : null;
}
