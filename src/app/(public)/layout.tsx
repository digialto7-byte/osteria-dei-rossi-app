import type { ReactNode } from "react";
import { PageMain } from "@/components/page-main";

// /login, /pin and /dispositivo: reachable signed out, so no shell and no navigation.
export default function PublicLayout({ children }: { children: ReactNode }) {
  return <PageMain>{children}</PageMain>;
}
