import type { ReactNode } from "react";
import { AppShell } from "./app-shell";

// Every signed-in page, home included, sits in the shell (ADR-020).
export default function OwnerLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
