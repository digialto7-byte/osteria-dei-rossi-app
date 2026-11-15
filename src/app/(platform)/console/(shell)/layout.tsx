import type { ReactNode } from "react";
import { ConsoleShell } from "@/components/console/console-shell";

// The signed-in screens: Locali, a venue, the Registro and Avvisi. The sign-in pages are outside this group, so they never read /api/platform/*.
export default function ConsoleShellLayout({ children }: { children: ReactNode }) {
  return <ConsoleShell>{children}</ConsoleShell>;
}
