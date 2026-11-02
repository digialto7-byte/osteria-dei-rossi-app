import { headers } from "next/headers";
import { loginNotice } from "@/lib/auth/login-view";
import { readDeviceCookieValue } from "@/server/staff-auth/device-cookie";
import { LoginScreen } from "./login-screen";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  const notice = loginNotice(typeof params.errore === "string" ? params.errore : undefined);
  // Only the presence of the device cookie picks the first view. Whether the device is still enrolled is
  // decided by the API (GET /api/auth/device), which the staff view reads.
  const hasDevice = readDeviceCookieValue((await headers()).get("cookie")) !== null;
  return (
    <LoginScreen
      next={next}
      notice={notice}
      hasDevice={hasDevice}
      justEnabled={params.abilitato === "1"}
    />
  );
}
