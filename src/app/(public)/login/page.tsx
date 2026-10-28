import Link from "next/link";
import { Card, ErrorAlert, linkClass } from "@/components/ui";
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
    <Card className="relative mt-4 overflow-hidden px-5 pt-7 pb-6">
      {/* A gold rule across the top of the card, like the edge of the printed menu. */}
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-gold" />
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          <h1 className="font-display text-[2.5rem] leading-none font-semibold tracking-[-0.01em] text-ink after:mt-4 after:block after:h-0.5 after:w-12 after:bg-gold">
            {t("login.title")}
          </h1>
          <p className="text-ink-muted">{t("login.intro")}</p>
        </div>
        {params.errore === "link" && <ErrorAlert message={t("login.linkError")} />}
        <LoginForm next={next} />
        {/* A new staff phone has no way to /dispositivo otherwise: the proxy sends it here. */}
        <Link href="/dispositivo" className={`${linkClass} self-start`}>
          {t("login.enrolLink")}
        </Link>
      </div>
    </Card>
  );
}
