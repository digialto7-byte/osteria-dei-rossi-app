import { withApi } from "@/lib/api/with-api";
import { getInvoiceOriginal } from "@/server/invoices/invoices";
import { idParams } from "@/server/master/schemas";

/**
 * The stored e-invoice file (XML, p7m) as a download. It is served only from here, never from the Storage origin, and always as an
 * opaque attachment: a stored XML file is the supplier's content and must never be rendered or sniffed as a page.
 */
export const GET = withApi(
  { roles: ["owner", "admin"], params: idParams },
  async ({ supabase, params }) => {
    const { blob, filename } = await getInvoiceOriginal(supabase, params.id);
    return new Response(blob.stream(), {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="${filename}"`,
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox; default-src 'none'",
        "cache-control": "no-store",
      },
    });
  },
);
