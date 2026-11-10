import type { MailEnv } from "@/lib/env";
import { createMailpitSender } from "./mailpit";
import { createResendSender } from "./resend";
import type { MailSender } from "./types";

export { MailError, type MailMessage, type MailSender } from "./types";

/** The sender `MAIL_TRANSPORT` names. `readMailEnv` has already refused mailpit in production and a missing key. */
export function createMailSender(env: MailEnv, fetchImpl?: typeof fetch): MailSender {
  if (env.transport === "mailpit") {
    return createMailpitSender({ url: env.mailpitUrl ?? "", fetch: fetchImpl });
  }
  return createResendSender({ apiKey: env.resendApiKey ?? "", fetch: fetchImpl });
}
