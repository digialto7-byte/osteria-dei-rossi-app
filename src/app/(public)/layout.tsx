import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PageMain } from "@/components/page-main";
import { PublicBand } from "./public-band";

// /login, /pin, /dispositivo and /prenota/*: reachable signed out, so no shell and no navigation, but the header band.
// The manifest is linked from the venue pages only, not the root layout: the console shares that layout and is not installable.
export const metadata: Metadata = { manifest: "/manifest.webmanifest" };

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PublicBand />
      <PageMain>{children}</PageMain>
    </>
  );
}
