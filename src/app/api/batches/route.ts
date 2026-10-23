import { withApi } from "@/lib/api/with-api";
import { MAX_BATCH_BODY_BYTES } from "@/server/batches/constants";
import { produceBatch } from "@/server/batches/produce";
import { produceBody } from "@/server/batches/schemas";

// Owner, admin and chef produce (founder, M12 Q1 applied to production); the waiter never.
export const POST = withApi(
  { roles: ["owner", "admin", "chef"], body: produceBody, maxBodyBytes: MAX_BATCH_BODY_BYTES },
  async ({ supabase, body }) => Response.json(await produceBatch(supabase, body), { status: 201 }),
);
