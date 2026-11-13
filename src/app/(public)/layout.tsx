import type { ReactNode } from "react";
import { HeaderBand } from "@/components/header-band";
import { PageMain } from "@/components/page-main";
import { PublicBrand } from "./public-brand";

// /login, /pin, /dispositivo and /prenota/*: reachable signed out, so no shell and no navigation, but the header band.
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <HeaderBand brand={<PublicBrand />} />
      <PageMain>{children}</PageMain>
    </>
  );
}
