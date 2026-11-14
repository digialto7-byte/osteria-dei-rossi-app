import type { ReactNode } from "react";
import { PageMain } from "@/components/page-main";
import { PublicBand } from "./public-band";

// /login, /pin, /dispositivo and /prenota/*: reachable signed out, so no shell and no navigation, but the header band.
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PublicBand />
      <PageMain>{children}</PageMain>
    </>
  );
}
