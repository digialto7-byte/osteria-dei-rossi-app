import {
  kindForStatus,
  MailError,
  SEND_TIMEOUT_MS,
  type MailMessage,
  type MailSender,
} from "./types";

const ENDPOINT = "https://api.resend.com/emails";

/** The `name` of a Resend error body, or undefined when the body is unreadable or not JSON. Only this field is read; the text is never kept or logged. */
async function errorName(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    const name =
      typeof body === "object" && body !== null ? (body as { name?: unknown }).name : undefined;
    return typeof name === "string" ? name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resend over one `fetch`, no package (plan §4, T-R2). `Idempotency-Key` is the outbox row id. Errors carry only a code and the HTTP status: the provider's
 * answer is not read into a message, because it can echo the address or the key; only the error `name` of a 409 is read, to tell a permanent conflict from a transient one.
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
        // Resend's 409 has two names: concurrent_idempotent_requests (same key in flight: retry) and invalid_idempotent_request (same key, other payload: permanent).
        if (
          response.status === 409 &&
          (await errorName(response)) === "invalid_idempotent_request"
        ) {
          throw new MailError("rejected", "resend_http_409_invalid_idempotent_request");
        }
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
