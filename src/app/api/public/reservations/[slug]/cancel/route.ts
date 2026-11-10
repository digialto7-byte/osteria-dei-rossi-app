import { withApi } from "@/lib/api/with-api";
import { parseQuery } from "@/server/counts/schemas";
import { MAX_PUBLIC_REQUEST_BYTES } from "@/server/reservations/constants";
import { cancelByLink, readCancelView } from "@/server/reservations/public/cancel";
import { linkInvalid } from "@/server/reservations/public/errors";
import { assertSameOrigin, readJsonBody, withNoindex } from "@/server/reservations/public/http";
import { cancelBody, cancelQuery, slugParams } from "@/server/reservations/public/schemas";

// Public (no login), noindex on every answer. The link is the e-mail's `?t=` token. GET only reads (mail scanners prefetch links); only POST cancels.
export const GET = withNoindex(
  withApi({ public: true, params: slugParams }, async ({ request, params }) => {
    let token: string;
    try {
      token = parseQuery(cancelQuery, new URL(request.url)).t;
    } catch {
      throw linkInvalid();
    }
    return Response.json(await readCancelView(params.slug, token, Date.now()));
  }),
);

export const POST = withNoindex(
  withApi(
    { public: true, params: slugParams, maxBodyBytes: MAX_PUBLIC_REQUEST_BYTES },
    async ({ request, params }) => {
      assertSameOrigin(request);
      const { token } = await readJsonBody(request, cancelBody, MAX_PUBLIC_REQUEST_BYTES);
      return Response.json(await cancelByLink(params.slug, token, Date.now()));
    },
  ),
);
