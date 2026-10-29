import { notFound, redirect } from "next/navigation";
import { comandaHref } from "@/lib/tables/comanda-url";

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The old address of the comanda, /tavoli/<id> (M18 links, bookmarks, tests). The order screen moved to the static page
 * /tavoli/comanda?s=<id> so it can open with no connection (M20 plan §3.6.4); this page only forwards. Anything that is not a uuid is a 404.
 */
export default async function OldOrderPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  if (!SESSION_ID.test(sessionId)) notFound();
  redirect(comandaHref(sessionId));
}
