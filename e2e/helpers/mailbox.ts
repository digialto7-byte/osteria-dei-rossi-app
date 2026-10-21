// Reads the local Supabase mail catcher (Mailpit). Isolated here because its API paths are the
// one piece of the local stack this project has not pinned down (M0 plan §6).
const POLL_INTERVAL_MS = 500;
const TIMEOUT_MS = 20_000;

interface MailpitSearch {
  messages: { ID: string }[];
}

export async function latestLinkFor(mailpitUrl: string, email: string): Promise<string> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const search = await fetch(
      `${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
    );
    if (search.ok) {
      const { messages } = (await search.json()) as MailpitSearch;
      const id = messages[0]?.ID;
      if (id) {
        const message = (await (await fetch(`${mailpitUrl}/api/v1/message/${id}`)).json()) as {
          Text: string;
        };
        const link = message.Text.match(/https?:\/\/\S+\/auth\/v1\/verify\S*/)?.[0];
        if (link) return link.replace(/[)\]>]+$/, "");
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`No magic-link email for ${email} within ${TIMEOUT_MS} ms`);
}
