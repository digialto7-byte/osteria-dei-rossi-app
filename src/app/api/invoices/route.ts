import { withApi } from "@/lib/api/with-api";
import { MAX_UPLOAD_BYTES, MULTIPART_OVERHEAD_BYTES } from "@/server/invoices/constants";
import {
  listInvoices,
  parseListInvoicesQuery,
  readUploadedFile,
  storeInvoiceUpload,
} from "@/server/invoices/invoices";

export const GET = withApi({ roles: ["owner", "admin"] }, async ({ request, supabase }) =>
  Response.json({
    invoices: await listInvoices(supabase, parseListInvoicesQuery(new URL(request.url))),
  }),
);

export const POST = withApi(
  {
    roles: ["owner", "admin"],
    multipart: { maxBodyBytes: MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES },
  },
  async ({ request, supabase, session }) => {
    const file = await readUploadedFile(request);
    const invoice = await storeInvoiceUpload(supabase, session, file, new Date());
    return Response.json(
      { invoice },
      { status: 202, headers: { location: `/api/invoices/${invoice.id}` } },
    );
  },
);
