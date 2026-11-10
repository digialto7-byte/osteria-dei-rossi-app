import {
  kindForStatus,
  MailError,
  SEND_TIMEOUT_MS,
  type MailMessage,
  type MailSender,
} from "./types";

/** `Name <a@b.c>` into Mailpit's `{Email, Name}`; a bare address has no Name. */
function address(value: string): { Email: string; Name?: string } {
  const match = /^\s*(.*?)\s*<([^<>]+)>\s*$/.exec(value);
  if (!match) return { Email: value.trim() };
  const name = match[1]!.replace(/^"|"$/g, "");
  return name ? { Email: match[2]!.trim(), Name: name } : { Email: match[2]!.trim() };
}

/**
 * The dev and test sink: Mailpit's JSON send API (`POST /api/v1/send`, T-R1), so the local Supabase mail catcher shows the e-mail and the e2e tests can read
 * it. Production refuses this transport (`readMailEnv`).
 */
export function createMailpitSender(options: { url: string; fetch?: typeof fetch }): MailSender {
  const doFetch = options.fetch ?? fetch;
  return {
    async send(message: MailMessage) {
      let response: Response;
      try {
        response = await doFetch(`${options.url.replace(/\/+$/, "")}/api/v1/send`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            From: address(message.from),
            To: [{ Email: message.to }],
            Subject: message.subject,
            Text: message.text,
            HTML: message.html,
          }),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
      } catch {
        throw new MailError("retry", "mailpit_unreachable");
      }
      if (!response.ok) {
        throw new MailError(kindForStatus(response.status), `mailpit_http_${response.status}`);
      }
      const id = await response.json().then(
        (body: unknown) =>
          typeof body === "object" && body !== null ? (body as { ID?: unknown }).ID : undefined,
        () => undefined,
      );
      return { providerId: typeof id === "string" && id !== "" ? id : "mailpit" };
    },
  };
}
