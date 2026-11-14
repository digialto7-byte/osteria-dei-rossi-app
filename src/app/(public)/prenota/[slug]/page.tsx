import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { localeFromQuery } from "@/lib/reservations/public-view";
import { RequestForm } from "./request-form";

// Guests book the osteria, not Costì: the tab title is the venue's name (Costì plan, lead decision VD).
export const metadata: Metadata = { title: t("venue.name") };

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
