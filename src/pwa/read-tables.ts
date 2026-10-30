import { apiJson } from "@/lib/api/client";

/**
 * Reads /api/tables through the worker (network-first, it stores a good answer) and says whether the answer came from the network.
 * An answer from the worker's own copy (`cachedAt`: the network failed or was slow) stored nothing new, so it counts as failed and the
 * refresh stays pending.
 */
export async function readTablesThroughWorker(
  read: (path: string) => Promise<{ ok: boolean; cachedAt?: string }> = (path) => apiJson(path),
): Promise<boolean> {
  try {
    const result = await read("/api/tables");
    return result.ok && result.cachedAt === undefined;
  } catch {
    return false;
  }
}
