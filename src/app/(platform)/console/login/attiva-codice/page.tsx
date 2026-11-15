import { ConsoleEnrol } from "@/components/console/console-enrol";
import { ConsoleLogout } from "@/components/console/console-logout";
import { Card, Heading, Muted } from "@/components/ui";
import { t } from "@/lib/i18n";

/**
 * The console's forced enrolment: a staff account with no second factor lands here after the password, or from a 403 mfa_factor_required.
 * It is reached only by a full document load (the QR image needs this page's own CSP). The wording is the venue app's (da approvare for the console).
 */
export default async function ConsoleEnrolPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  return (
    <Card className="mt-4 flex flex-col gap-5 px-5 pt-7 pb-6">
      <Heading>{t("mfa.enrol.title")}</Heading>
      <Muted>{t("mfa.enrol.forced")}</Muted>
      <ConsoleEnrol next={next} />
      <ConsoleLogout tone="plain" />
    </Card>
  );
}
