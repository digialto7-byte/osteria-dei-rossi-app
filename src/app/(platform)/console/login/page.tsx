import { ConsoleSignIn } from "@/components/console/console-sign-in";
import { loginNotice } from "@/lib/auth/login-view";

/** The console sign-in. The frame (band, logo) is the login layout's. */
export default async function ConsoleLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const notice = loginNotice(typeof params.errore === "string" ? params.errore : undefined);
  return <ConsoleSignIn notice={notice} />;
}
