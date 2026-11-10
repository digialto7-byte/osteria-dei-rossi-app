import {
  kindForStatus,
  MailError,
  SEND_TIMEOUT_MS,
  type MailMessage,
  type MailSender,
} from "./types";

const ENDPOINT = "https://api.resend.com/emails";

/**
 * Resend over one `fetch`, no package (plan §4, T-R2). `Idempotency-Key` is the outbox row id. Errors carry only a code and the HTTP status: the provider's
 * answer is not read into a message, because it can echo the address or the key.
 */
export function createResendSender(options: { apiKey: string; fetch?: typeof fetch }): MailSender {
  const doFetch = options.fetch ?? fetch;
  return {
    async send(message: MailMessage) {
      let response: Response;
      try {
        response = await doFetch(ENDPOINT, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            "content-type": "application/json",
            "idempotency-key": message.idempotencyKey,
          },
          body: JSON.stringify({
            from: message.from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
          }),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
      } catch {
        throw new MailError("retry", "resend_unreachable");
      }
      if (!response.ok) {
        throw new MailError(kindForStatus(response.status), `resend_http_${response.status}`);
      }
      const id = await response.json().then(
        (body: unknown) =>
          typeof body === "object" && body !== null ? (body as { id?: unknown }).id : undefined,
        () => undefined,
      );
      if (typeof id !== "string" || id === "") throw new MailError("retry", "resend_no_id");
      return { providerId: id };
    },
  };
}
