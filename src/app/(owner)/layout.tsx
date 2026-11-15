import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "./app-shell";

// Every signed-in page, home included, sits in the shell (ADR-020).
// The manifest is linked from the venue pages only, not the root layout: the console shares that layout and is not installable.
export const metadata: Metadata = { manifest: "/manifest.webmanifest" };

export default function OwnerLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
