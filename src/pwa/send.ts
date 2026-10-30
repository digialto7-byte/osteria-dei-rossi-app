import { apiJson } from "@/lib/api/client";
import type { SendResult } from "@/lib/sync/replay";
import { syncOutput } from "@/server/sync/output";
import { SYNC_REQUEST_TIMEOUT_MS } from "@/server/sync/constants";
import type { OpEnvelope } from "@/server/sync/schemas";

/**
 * POST /api/sync for the replay engine (M20 plan §3.1.7 step 5). A thrown fetch is a network failure; 401 and 403 are their own;
 * every other failure, and a 200 that is not the sync output (a Wi-Fi login page), is a server failure: nothing is settled and the
 * engine backs off. A 4xx other than 429 counts toward the stuck notice.
 */
export async function sendOps(
  ops: OpEnvelope[],
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  // A request that never answers is abandoned after SYNC_REQUEST_TIMEOUT_MS (the replay lease is longer than that, so a live page never
  // loses its lease to a hung request); the ops stay and go again, and the server answers an op it already took as a duplicate.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SYNC_REQUEST_TIMEOUT_MS);
  let result;
  try {
    result = await apiJson<unknown>(
      "/api/sync",
      { method: "POST", body: { ops }, signal: controller.signal },
      fetchImpl,
    );
  } finally {
    clearTimeout(timer);
  }
  if (result.ok) {
    const parsed = syncOutput.safeParse(result.data);
    return parsed.success
      ? { kind: "ok", output: parsed.data }
      : { kind: "server", status: result.status };
  }
  if (result.status === 0) return { kind: "network" };
  if (result.status === 401) return { kind: "unauthorized" };
  if (result.status === 403) return { kind: "forbidden" };
  return { kind: "server", status: result.status };
}
