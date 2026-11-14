import { withApi } from "@/lib/api/with-api";
import {
  FATTURA_KINDS,
  MAX_UPLOAD_BYTES,
  MULTIPART_OVERHEAD_BYTES,
} from "@/server/invoices/constants";
import { sniffKind } from "@/server/invoices/file-check";
import {
  listInvoices,
  parseListInvoicesQuery,
  readUploadedFile,
  storeInvoiceUpload,
} from "@/server/invoices/invoices";
import { storeXmlUpload } from "@/server/invoices/xml-upload";

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
    // An e-invoice file (XML, or signed p7m) is read by our own parser and imported at once: 201 with the invoices it made.
    // Documents (PDF, photos) keep the queue for the AI reader: 202.
    const kind = sniffKind(file.bytes);
    if (kind && FATTURA_KINDS.includes(kind)) {
      const result = await storeXmlUpload(supabase, session, file, new Date());
      return Response.json(result, {
        status: 201,
        headers: { location: `/api/invoices/${result.invoice.id}` },
      });
    }
    const invoice = await storeInvoiceUpload(supabase, session, file, new Date());
    return Response.json(
      { invoice },
      { status: 202, headers: { location: `/api/invoices/${invoice.id}` } },
    );
  },
);
