// Reads the reservation e-mails from the local mail catcher (Mailpit) through its REST API. No imports, so the real-stack suite and the Playwright specs read them the same way
// (e2e/helpers/mailbox.ts does for the sign-in e-mail). Fake data only.

const LIST_LIMIT = 50;

/** What one run of the mail job reports (the cron route's JSON). */
export interface MailJobRound {
  handled: number;
  sent: number;
  failed: number;
}

/** One run claims only the oldest few due rows, so other suites' leftovers could push ours out of the first run. */
export const MAIL_DRAIN_MAX_ROUNDS = 10;

/**
 * Runs the mail job until it handles nothing, at most `maxRounds` times (so a stuck row cannot loop forever), and adds the rounds up. The production batch
 * size is untouched; the tests just keep asking until their own e-mail has been through.
 */
export async function drainMailJob(
  run: () => Promise<MailJobRound>,
  maxRounds: number = MAIL_DRAIN_MAX_ROUNDS,
  options: { budgetMs?: number; now?: () => number } = {},
): Promise<MailJobRound & { rounds: number }> {
  const now = options.now ?? Date.now;
  const started = now();
  const total = { handled: 0, sent: 0, failed: 0, rounds: 0 };
  while (total.rounds < maxRounds) {
    const result = await run();
    total.rounds += 1;
    total.handled += result.handled;
    total.sent += result.sent;
    total.failed += result.failed;
    if (result.handled === 0) break;
    // A round can take up to a batch of 10 s sends: without a budget ten of them outlast a whole test. Counts only, no addresses.
    if (options.budgetMs !== undefined && now() - started >= options.budgetMs) {
      throw new Error(
        `mail drain over budget after ${total.rounds} rounds (handled ${total.handled}, sent ${total.sent}, failed ${total.failed}, ${now() - started} ms)`,
      );
    }
  }
  return total;
}

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
  options: {
    subject: RegExp;
    timeoutMs?: number;
    intervalMs?: number;
    /** One request to Mailpit may take this long (default 5 s); a request that hangs counts as "not yet", never as a hang of the whole wait. */
    requestTimeoutMs?: number;
    fetch?: typeof fetch;
  },
): Promise<FoundMail> {
  const doFetch = options.fetch ?? fetch;
  const deadline = Date.now() + (options.timeoutMs ?? 20_000);
  const requestTimeoutMs = options.requestTimeoutMs ?? 5_000;
  const get = (url: string) => doFetch(url, { signal: AbortSignal.timeout(requestTimeoutMs) });
  let seen: string[] = [];
  for (;;) {
    const response = await get(`${mailpitUrl}/api/v1/messages?limit=${LIST_LIMIT}`).catch(
      () => null,
    );
    if (response?.ok) {
      const { messages } = (await response.json()) as { messages: Summary[] };
      const mine = messages.filter((m) =>
        m.To?.some((to) => to.Address.toLowerCase() === email.toLowerCase()),
      );
      seen = mine.map((m) => m.Subject);
      // Mailpit lists the newest first.
      const match = mine.find((m) => options.subject.test(m.Subject));
      if (match) {
        const detail = (await (await get(`${mailpitUrl}/api/v1/message/${match.ID}`)).json()) as {
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
