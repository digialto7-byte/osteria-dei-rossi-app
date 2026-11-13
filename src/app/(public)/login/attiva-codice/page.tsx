import { EnrolToNext } from "@/components/mfa/enrol-to-next";
import { LogoutButton } from "@/components/logout-button";
import { Card, Heading, Muted } from "@/components/ui";
import { t } from "@/lib/i18n";

/**
 * Forced enrolment (P2-1, plan section 3.13): an admin under `required` without a factor lands here from any page (403 mfa_enrol_required) and from sign-in.
 * Outside the owner shell on purpose: it makes no /api/me call, so it cannot loop. Only the enrolment routes answer to an account in this state.
 */
export default async function ForcedEnrolPage({
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
      <EnrolToNext next={next} />
      <LogoutButton />
    </Card>
  );
}
