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
    <>
      <h1 className="text-2xl font-semibold">{t("login.title")}</h1>
      <p>{t("login.intro")}</p>
      {params.errore === "link" && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-red-900">
          {t("login.linkError")}
        </p>
      )}
      <LoginForm next={next} />
    </>
  );
}
