// Keep-alive ping (M25 step 10, plan §3.1.7): one GET of the project's Auth health endpoint with the publishable key. On
// Supabase Free it is a likely, not verified, activity signal; a failure also tells us the project is paused. Errors carry a
// status or a word, never the key or the URL.

export async function pingAuthHealth(
  fetchFn: typeof fetch,
  supabaseUrl: string,
  publishableKey: string,
): Promise<void> {
  let origin: string;
  try {
    const url = new URL(supabaseUrl);
    if (url.protocol !== "https:") throw new Error("not https");
    origin = url.origin;
  } catch {
    throw new Error("keepalive_failed:url");
  }
  let response: Response;
  try {
    response = await fetchFn(`${origin}/auth/v1/health`, {
      method: "GET",
      headers: { apikey: publishableKey },
    });
  } catch {
    throw new Error("keepalive_failed:network");
  }
  if (!response.ok) throw new Error(`keepalive_failed:${response.status}`);
}
