import { withApi } from "@/lib/api/with-api";
import { canReadBatchCosts } from "@/lib/batches/batch-view";
import { MAX_BATCH_BODY_BYTES } from "@/server/batches/constants";
import { listBatches } from "@/server/batches/list";
import { produceBatch } from "@/server/batches/produce";
import { parseBatchesQuery, produceBody } from "@/server/batches/schemas";

// Owner, admin and chef read and produce (founder, M12 Q1 applied to production); the waiter never. The frozen cost
// is added to the list for the owner and the admin only (Q16 = project V6).
export const GET = withApi(
  { roles: ["owner", "admin", "chef"] },
  async ({ request, session, supabase }) =>
    Response.json(
      await listBatches(
        supabase,
        parseBatchesQuery(new URL(request.url)),
        canReadBatchCosts(session.role),
      ),
    ),
);

export const POST = withApi(
  { roles: ["owner", "admin", "chef"], body: produceBody, maxBodyBytes: MAX_BATCH_BODY_BYTES },
  async ({ supabase, body }) => Response.json(await produceBatch(supabase, body), { status: 201 }),
);
