// Reads the 6-digit code of the sign-in e-mail from the local mail catcher (Mailpit). Used by the real-stack
// password-login suite only; the Playwright twin lives in e2e/helpers/mailbox.ts.

const POLL_INTERVAL_MS = 500;
const TIMEOUT_MS = 20_000;
const LIST_LIMIT = 50;

/** The code in an e-mail's text: a line of its own first, else a standalone six-digit word outside any link. */
export function codeFromMailText(text: string): string | null {
  const alone = /^\s*(\d{6})\s*$/m.exec(text)?.[1];
  if (alone) return alone;
  const withoutLinks = text.replace(/https?:\/\/\S+/g, " ");
  return /(?<![\w-])(\d{6})(?![\w-])/.exec(withoutLinks)?.[1] ?? null;
}

interface Summary {
  ID: string;
  To: { Address: string }[] | null;
}

/** The code of the newest e-mail sent to `email`; polls until one arrives. */
export async function latestCodeFor(mailpitUrl: string, email: string): Promise<string> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const list = await fetch(`${mailpitUrl}/api/v1/messages?limit=${LIST_LIMIT}`);
    if (list.ok) {
      const { messages } = (await list.json()) as { messages: Summary[] };
      const match = messages.find((m) =>
        m.To?.some((to) => to.Address.toLowerCase() === email.toLowerCase()),
      );
      if (match) {
        const message = (await (
          await fetch(`${mailpitUrl}/api/v1/message/${match.ID}`)
        ).json()) as {
          Text: string;
        };
        const code = codeFromMailText(message.Text);
        if (code) return code;
        throw new Error(`Email ${match.ID} has no 6-digit code`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`No sign-in email for ${email} within ${TIMEOUT_MS} ms`);
}
