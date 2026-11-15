import { ConsoleChallenge } from "@/components/console/console-challenge";
import { Card, Heading } from "@/components/ui";
import { t } from "@/lib/i18n";

/** The console's code step after the password (or after a 403 mfa_required on a console page). */
export default async function ConsoleCodePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  return (
    <Card className="mt-4 flex flex-col gap-5 px-5 pt-7 pb-6">
      <Heading>{t("mfa.challenge.title")}</Heading>
      <ConsoleChallenge next={next} />
    </Card>
  );
}
