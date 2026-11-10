import { withApi } from "@/lib/api/with-api";
import { readPublicPage } from "@/server/reservations/public/page";
import { slugParams } from "@/server/reservations/public/schemas";

// Public (no login). The page reads its configuration here; the answer is the same 404 for an unknown, a disabled and a not-ready slug.
export const GET = withApi({ public: true, params: slugParams }, async ({ params }) =>
  Response.json(await readPublicPage(params.slug, Date.now())),
);
