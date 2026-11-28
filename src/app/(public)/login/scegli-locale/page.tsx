import { Card, Heading } from "@/components/ui";
import { t } from "@/lib/i18n";
import { highlightOf } from "./highlight";
import { VenuePicker } from "./venue-picker";

/**
 * The venue chooser (SP2, Q-S4): a login that holds several venues and has chosen none lands here from the API's 409. `next` is the page it
 * came from; `switchTenant` validates it. `locale` (SP3 step 19, «Entra nel locale») only lists that venue first and marks it; nothing switches on load. The list comes from GET /api/me/tenants, never an offline-cached copy.
 */
export default async function ChooseVenuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  const highlight = highlightOf(params.locale);
  return (
    <Card className="mt-4 flex flex-col gap-5 px-5 pt-7 pb-6">
      <Heading>{t("tenantSwitch.title")}</Heading>
      <VenuePicker next={next} highlight={highlight} self={selfPath(next, highlight)} />
    </Card>
  );
}

/** This page with the parameters it understood, for the way back from the sign-in or the code page (made safe again there). */
function selfPath(next: string | undefined, highlight: string | undefined): string {
  const query = new URLSearchParams();
  if (next !== undefined) query.set("next", next);
  if (highlight !== undefined) query.set("locale", highlight);
  const text = query.toString();
  return text === "" ? "/login/scegli-locale" : `/login/scegli-locale?${text}`;
}
