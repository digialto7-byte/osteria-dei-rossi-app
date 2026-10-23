import { withApi } from "@/lib/api/with-api";
import { getProposal } from "@/server/batches/proposal";
import { parseProposalQuery } from "@/server/batches/schemas";

export const GET = withApi({ roles: ["owner", "admin", "chef"] }, async ({ request, supabase }) =>
  Response.json(await getProposal(supabase, parseProposalQuery(new URL(request.url)))),
);
