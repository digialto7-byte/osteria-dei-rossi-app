import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { SyncKind } from "@/server/sync/constants";
import type { OpEnvelope } from "@/server/sync/schemas";
import type { Stack, TestUser } from "./stack";

// Helpers of the offline-queue suite (M20 plan §5 step 12), fake data only.

/** The app_user id of a test user (what an op names in `userId`), read with the secret key. */
export async function appUserId(stack: Stack, user: TestUser): Promise<string> {
  const read = await stack.admin.from("app_user").select("id").eq("auth_id", user.authId).single();
  expect(read.error).toBeNull();
  return read.data!.id as string;
}

let nextSeq = 1;

/**
 * An op as the phone would build it: a fresh op id, the next `seq`, the stamp `msFromNow` from now (negative = in the past)
 * and the id of the user who queued it. The payload never carries a stamp: `clientTs` is the line's `clientUpdatedAt`.
 */
export function opFor(
  kind: SyncKind,
  payload: Record<string, unknown>,
  userId: string,
  options: { msFromNow?: number; opId?: string; seq?: number } = {},
): OpEnvelope {
  return {
    opId: options.opId ?? randomUUID(),
    seq: options.seq ?? nextSeq++,
    kind,
    clientTs: new Date(Date.now() + (options.msFromNow ?? -1_000)).toISOString(),
    userId,
    payload,
  };
}
