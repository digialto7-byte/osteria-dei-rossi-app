// SP0 spike (§3.4, S8): reads the sign-in e-mail from the LOCAL mail catcher (Mailpit). Hosted runs send no mail (LD-4).
// Messages are listed and filtered by recipient here, so the only API surface relied on is GET /api/v1/messages and
// GET /api/v1/message/:id. The e-mail address and the link never leave this module's return values; reports never hold them.

export interface MailRead {
  id: string;
  /** The 6-digit code, or null when the mail has none. */
  code: string | null;
  /** The `/auth/v1/verify` link, or null when the mail has none. */
  link: string | null;
}

/** The code of the sign-in mail: a line of its own first, else a standalone six-digit word outside any link. The link: the verify URL. */
export function parseSignInMail(text: string): { code: string | null; link: string | null } {
  const alone = /^\s*(\d{6})\s*$/m.exec(text)?.[1];
  const withoutLinks = text.replace(/https?:\/\/\S+/g, " ");
  const code = alone ?? /(?<![\w-])(\d{6})(?![\w-])/.exec(withoutLinks)?.[1] ?? null;
  const rawLink = /https?:\/\/\S+\/auth\/v1\/verify\S*/.exec(text)?.[0];
  return { code, link: rawLink === undefined ? null : rawLink.replace(/[)\]>]+$/, "") };
}

interface Summary {
  ID: string;
  To: { Address: string }[] | null;
}

export interface MailDeps {
  mailpitUrl: string;
  fetchImpl: typeof fetch;
  sleep(ms: number): Promise<void>;
  /** How many times to look, and the pause between looks. */
  attempts: number;
  pollMs: number;
}

/** The newest message to `email` whose id is not in `knownIds`. Throws when none arrives (the message holds no address). */
export async function readNewestMail(
  deps: MailDeps,
  email: string,
  knownIds: readonly string[],
): Promise<MailRead> {
  for (let attempt = 0; attempt < deps.attempts; attempt += 1) {
    const list = await deps.fetchImpl(`${deps.mailpitUrl}/api/v1/messages?limit=50`);
    if (!list.ok) throw new Error(`The mail catcher answered ${list.status}.`);
    const { messages } = (await list.json()) as { messages: Summary[] };
    // Mailpit lists the newest first.
    const match = messages.find(
      (m) =>
        !knownIds.includes(m.ID) &&
        m.To?.some((to) => to.Address.toLowerCase() === email.toLowerCase()),
    );
    if (match !== undefined) {
      const detail = await deps.fetchImpl(`${deps.mailpitUrl}/api/v1/message/${match.ID}`);
      if (!detail.ok) throw new Error(`The mail catcher answered ${detail.status} for a message.`);
      const { Text } = (await detail.json()) as { Text: string };
      return { id: match.ID, ...parseSignInMail(Text) };
    }
    if (attempt < deps.attempts - 1) await deps.sleep(deps.pollMs);
  }
  throw new Error("No new sign-in e-mail arrived in time.");
}
