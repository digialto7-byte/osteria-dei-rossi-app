import { z } from "zod";
import { withApi } from "@/lib/api/with-api";
import { parseQuery } from "@/server/counts/schemas";
import { MAX_PUBLIC_REQUEST_BYTES } from "@/server/reservations/constants";
import { cancelByLink, readCancelView } from "@/server/reservations/public/cancel";
import { linkInvalid } from "@/server/reservations/public/errors";
import { assertSameOrigin, readJsonBody, withNoindex } from "@/server/reservations/public/http";
import { cancelBody, cancelQuery, slugParams } from "@/server/reservations/public/schemas";

// A slug that is not a slug is one more bad link: the same 404 link_invalid as a bad token, not withApi's generic not_found. So withApi only sees a string here and
// the handlers check the pattern with slugParams, the schema of the other public routes.
const anySlug = z.object({ slug: z.string() });
function checkedSlug(params: { slug: string }): string {
  const parsed = slugParams.safeParse(params);
  if (!parsed.success) throw linkInvalid();
  return parsed.data.slug;
}

// Public (no login), noindex on every answer. The link is the e-mail's `?t=` token. GET only reads (mail scanners prefetch links); only POST cancels.
export const GET = withNoindex(
  withApi({ public: true, params: anySlug }, async ({ request, params }) => {
    const slug = checkedSlug(params);
    let token: string;
    try {
      token = parseQuery(cancelQuery, new URL(request.url)).t;
    } catch {
      throw linkInvalid();
    }
    return Response.json(await readCancelView(slug, token, Date.now()));
  }),
);

export const POST = withNoindex(
  withApi(
    { public: true, params: anySlug, maxBodyBytes: MAX_PUBLIC_REQUEST_BYTES },
    async ({ request, params }) => {
      assertSameOrigin(request);
      const { token } = await readJsonBody(request, cancelBody, MAX_PUBLIC_REQUEST_BYTES);
      return Response.json(await cancelByLink(checkedSlug(params), token, Date.now()));
    },
  ),
);
