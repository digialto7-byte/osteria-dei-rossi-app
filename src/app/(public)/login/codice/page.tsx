import { Card, Heading } from "@/components/ui";
import { t } from "@/lib/i18n";
import { ChallengeForm } from "./challenge-form";

/** The code step after the password, the e-mail code or the link (P2-1): an owner or admin with a verified factor passes it to reach any data. */
export default async function ChallengePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  return (
    <Card className="mt-4 flex flex-col gap-5 px-5 pt-7 pb-6">
      <Heading>{t("mfa.challenge.title")}</Heading>
      <ChallengeForm next={next} />
    </Card>
  );
}
