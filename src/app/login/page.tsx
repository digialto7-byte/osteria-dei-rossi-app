import { Card, ErrorAlert } from "@/components/ui";
import { t } from "@/lib/i18n";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  return (
    <Card className="relative mt-4 overflow-hidden px-0 pt-7 pb-6">
      {/* The red margin rule of a ledger page; purely decorative. */}
      <span aria-hidden="true" className="absolute inset-y-0 left-5 w-px bg-accent opacity-45" />
      <span aria-hidden="true" className="absolute inset-y-0 left-6 w-px bg-accent opacity-25" />
      <div className="flex flex-col gap-5 pr-5 pl-10">
        <div className="flex flex-col gap-2 border-b-[3px] border-double border-rule pb-4">
          <h1 className="font-display text-[2.75rem] leading-none font-normal tracking-[-0.02em] text-ink">
            {t("login.title")}
          </h1>
          <p className="text-ink-muted">{t("login.intro")}</p>
        </div>
        {params.errore === "link" && <ErrorAlert message={t("login.linkError")} />}
        <LoginForm next={next} />
      </div>
    </Card>
  );
}
