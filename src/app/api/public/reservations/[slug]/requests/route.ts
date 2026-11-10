import { withApi } from "@/lib/api/with-api";
import { MAX_PUBLIC_REQUEST_BYTES } from "@/server/reservations/constants";
import { assertSameOrigin, clientIp, readJsonBody } from "@/server/reservations/public/http";
import { submitPublicRequest } from "@/server/reservations/public/request";
import { requestBody, slugParams } from "@/server/reservations/public/schemas";

// Public (no login). Order: JSON only and Content-Length (withApi) -> Origin -> the bytes read (4 KB) and the strict body -> honeypot -> form token -> the gated RPC.
// No `body` option: withApi would parse (and reject) the body before the Origin is checked.
export const POST = withApi(
  { public: true, params: slugParams, maxBodyBytes: MAX_PUBLIC_REQUEST_BYTES },
  async ({ request, params }) => {
    assertSameOrigin(request);
    const body = await readJsonBody(request, requestBody, MAX_PUBLIC_REQUEST_BYTES);
    const reply = await submitPublicRequest({
      slug: params.slug,
      body,
      ip: clientIp(request),
      nowMs: Date.now(),
    });
    return Response.json(reply, { status: 202 });
  },
);
