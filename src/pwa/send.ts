import { apiJson } from "@/lib/api/client";
import type { SendResult } from "@/lib/sync/replay";
import { syncOutput } from "@/server/sync/output";
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
  const result = await apiJson<unknown>("/api/sync", { method: "POST", body: { ops } }, fetchImpl);
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
