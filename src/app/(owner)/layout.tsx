import type { Metadata } from "next";
import type { ReactNode } from "react";
import { readAppOrigin, readConsoleHost } from "@/lib/env";
import { consoleHomeUrl } from "@/lib/platform/console-url";
import { AppShell } from "./app-shell";

// Every signed-in page, home included, sits in the shell (ADR-020).
// The manifest is linked from the venue pages only, not the root layout: the console shares that layout and is not installable.
export const metadata: Metadata = { manifest: "/manifest.webmanifest" };

export default function OwnerLayout({ children }: { children: ReactNode }) {
  // SP3 step 19: «Torna alla console» for the admin, only when CONSOLE_HOST is set (no console anywhere otherwise, Q-P12).
  return (
    <AppShell consoleUrl={consoleHomeUrl(readConsoleHost(), readAppOrigin())}>{children}</AppShell>
  );
}
