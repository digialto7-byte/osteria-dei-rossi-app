import "server-only";
import { createSupabaseAnonClient } from "@/lib/supabase/anon";
import { reportError } from "@/lib/observability/report";
import type { z } from "zod";
import { GATE_REFUSED, mapPublicDbError, unconfigured } from "./errors";
import { gateArgs, type GateFunction } from "./gate";
import { loadReservationEnv } from "./http";
import { parseReply } from "./output";

/**
 * Calls one of the five gated anon functions: the gate (function, slug, second) goes in the first three arguments, the reply is parsed strictly, and a database
 * error becomes an ApiError. The client is always `anon` (no cookies). `nowMs` is the clock, passed in.
 */
export async function callGated<S extends z.ZodType>(
  fn: GateFunction,
  slug: string,
  args: Record<string, unknown>,
  schema: S,
  nowMs: number,
): Promise<z.infer<S>> {
  const env = loadReservationEnv();
  const anon = createSupabaseAnonClient();
  const { data, error } = await anon.rpc(fn, {
    ...gateArgs(env.gateKey, fn, slug, nowMs),
    ...args,
  });
  if (error) {
    const mapped = mapPublicDbError(error);
    if (mapped.message === GATE_REFUSED) {
      // The Vercel key and the Vault key differ (or the clocks do): the operator must see it; the customer sees "unavailable".
      reportError(mapped);
      throw unconfigured();
    }
    throw mapped;
  }
  return parseReply(schema, data);
}
