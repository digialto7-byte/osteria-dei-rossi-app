// Reads the reservation e-mails from the local mail catcher (Mailpit) through its REST API. No imports, so the real-stack suite and the Playwright specs read them the same way
// (e2e/helpers/mailbox.ts does for the sign-in e-mail). Fake data only.

const LIST_LIMIT = 50;

interface Summary {
  ID: string;
  Subject: string;
  To: { Address: string }[] | null;
}

export interface FoundMail {
  id: string;
  subject: string;
  text: string;
}

/** The cancel link in an e-mail's text: its URL, the page's slug and the token. */
export function cancelLinkFrom(text: string): { url: string; slug: string; token: string } | null {
  const match = /(\S+\/prenota\/([a-z0-9-]+)\/annulla\?t=([^\s)>\]]+))/.exec(text);
  return match ? { url: match[1]!, slug: match[2]!, token: match[3]! } : null;
}

/**
 * The newest e-mail to `email` whose subject matches, as its text; polls until one arrives. On a timeout the error names the address and the subjects seen, never a
 * body.
 */
export async function waitForMail(
  mailpitUrl: string,
  email: string,
  options: { subject: RegExp; timeoutMs?: number; intervalMs?: number; fetch?: typeof fetch },
): Promise<FoundMail> {
  const doFetch = options.fetch ?? fetch;
  const deadline = Date.now() + (options.timeoutMs ?? 20_000);
  let seen: string[] = [];
  for (;;) {
    const response = await doFetch(`${mailpitUrl}/api/v1/messages?limit=${LIST_LIMIT}`);
    if (response.ok) {
      const { messages } = (await response.json()) as { messages: Summary[] };
      const mine = messages.filter((m) =>
        m.To?.some((to) => to.Address.toLowerCase() === email.toLowerCase()),
      );
      seen = mine.map((m) => m.Subject);
      // Mailpit lists the newest first.
      const match = mine.find((m) => options.subject.test(m.Subject));
      if (match) {
        const detail = (await (
          await doFetch(`${mailpitUrl}/api/v1/message/${match.ID}`)
        ).json()) as {
          Text: string;
        };
        return { id: match.ID, subject: match.Subject, text: detail.Text };
      }
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `No e-mail matching ${options.subject} for ${email}. Subjects seen: ${seen.join(" | ") || "none"}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 500));
  }
}
