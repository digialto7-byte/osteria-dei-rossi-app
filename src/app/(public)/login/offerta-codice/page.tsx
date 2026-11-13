import { Card, Heading } from "@/components/ui";
import { t } from "@/lib/i18n";
import { OfferScreen } from "./offer-screen";

/**
 * Offered after the first factor to an owner or admin who has no second factor yet and is not forced (T-11, plan section 3.13). Optional for the owner:
 * "Non ora" continues to `next` and the offer comes back at the next sign-in.
 */
export default async function OfferPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  return (
    <Card className="mt-4 flex flex-col gap-5 px-5 pt-7 pb-6">
      <Heading>{t("mfa.offer.title")}</Heading>
      <OfferScreen next={next} />
    </Card>
  );
}
