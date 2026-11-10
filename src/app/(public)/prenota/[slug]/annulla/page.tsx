import type { Metadata } from "next";
import { localeFromQuery } from "@/lib/reservations/public-view";
import { CancelView } from "./cancel-view";

// A private page: the link carries a token. Search engines are told not to index it, and the browser not to send the address on to anything it links to.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function CancelPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const { t, lang } = await searchParams;
  return (
    <CancelView
      slug={slug}
      token={typeof t === "string" && t !== "" ? t : null}
      locale={localeFromQuery(lang)}
    />
  );
}
