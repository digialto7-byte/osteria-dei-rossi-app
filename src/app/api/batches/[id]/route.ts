import { withApi } from "@/lib/api/with-api";
import { getBatchDetail } from "@/server/batches/detail";
import { idParams } from "@/server/batches/schemas";

// Owner, admin and chef read a batch; the waiter never. No cost key (Q16 = project V6).
export const GET = withApi(
  { roles: ["owner", "admin", "chef"], params: idParams },
  async ({ supabase, params }) => Response.json(await getBatchDetail(supabase, params.id)),
);
