/** One e-mail to one person. The idempotency key is the outbox row id, so a retry cannot send it twice. */
export interface MailMessage {
  to: string;
  /** `address@example.com` or `Name <address@example.com>`. */
  from: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
}

export interface MailSender {
  send(message: MailMessage): Promise<{ providerId: string }>;
}

/**
 * Why a send failed: `retry` for a rate limit, a server error or a network failure (try again later), `rejected` for any other refusal (do not retry).
 * The message is a short code. It never holds the key, the address or the body.
 */
export class MailError extends Error {
  constructor(
    public readonly kind: "retry" | "rejected",
    message: string,
  ) {
    super(message);
    this.name = "MailError";
  }
}

/**
 * A provider's status as a MailError kind. 408 (timeout) and 409 (Resend's concurrent_idempotent_requests: the same
 * Idempotency-Key is still in flight) clear on their own, so they are retried like 429 and 5xx. Resend's other 409,
 * invalid_idempotent_request (same key, different payload), is permanent: the Resend sender reads the error name and rejects it.
 */
export const kindForStatus = (status: number): "retry" | "rejected" =>
  status === 408 || status === 409 || status === 429 || status >= 500 ? "retry" : "rejected";

/** How long one provider call may take before it counts as a network failure. */
export const SEND_TIMEOUT_MS = 10_000;
