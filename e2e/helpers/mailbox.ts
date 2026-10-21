// Reads the local Supabase mail catcher (Mailpit) through its REST API. Messages are listed and
// filtered by recipient here rather than through Mailpit's search syntax, so the only API
// surface relied on is GET /api/v1/messages and GET /api/v1/message/:id.
const POLL_INTERVAL_MS = 500;
const TIMEOUT_MS = 20_000;
const LIST_LIMIT = 50;

interface MailpitSummary {
  ID: string;
  To: { Address: string }[] | null;
}

async function recentMessages(mailpitUrl: string): Promise<MailpitSummary[] | string> {
  try {
    const response = await fetch(`${mailpitUrl}/api/v1/messages?limit=${LIST_LIMIT}`);
    if (!response.ok) return `HTTP ${response.status}`;
    return ((await response.json()) as { messages: MailpitSummary[] }).messages;
  } catch (error) {
    return `unreachable (${error instanceof Error ? error.message : String(error)})`;
  }
}

export async function latestLinkFor(mailpitUrl: string, email: string): Promise<string> {
  const deadline = Date.now() + TIMEOUT_MS;
  let lastSeen: MailpitSummary[] | string = [];
  while (Date.now() < deadline) {
    lastSeen = await recentMessages(mailpitUrl);
    const match =
      typeof lastSeen === "string"
        ? undefined
        : lastSeen.find((m) =>
            m.To?.some((to) => to.Address.toLowerCase() === email.toLowerCase()),
          );
    if (match) {
      const message = (await (await fetch(`${mailpitUrl}/api/v1/message/${match.ID}`)).json()) as {
        Text: string;
      };
      const link = message.Text.match(/https?:\/\/\S+\/auth\/v1\/verify\S*/)?.[0];
      if (link) return link.replace(/[)\]>]+$/, "");
      throw new Error(`Email ${match.ID} has no /auth/v1/verify link`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  const seen =
    typeof lastSeen === "string"
      ? `Mailpit ${lastSeen}`
      : `Mailpit holds ${lastSeen.length} message(s) for: ${
          lastSeen.flatMap((m) => m.To?.map((to) => to.Address) ?? []).join(", ") || "nobody"
        }`;
  throw new Error(`No magic-link email for ${email} within ${TIMEOUT_MS} ms. ${seen}`);
}
