import { localeFromQuery } from "@/lib/reservations/public-view";
import { RequestForm } from "./request-form";

// Public (no login), rendered per request like every page under the nonce policy (ADR-028). `?lang=en` is the second language.
export default async function BookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const { lang } = await searchParams;
  return <RequestForm slug={slug} locale={localeFromQuery(lang)} />;
}
