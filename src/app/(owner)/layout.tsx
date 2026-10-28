import type { ReactNode } from "react";
import { PageMain } from "@/components/page-main";
import { DemoBanner } from "./demo-banner";
import { OwnerNav } from "./owner-nav";

export default function OwnerLayout({ children }: { children: ReactNode }) {
  return (
    <PageMain>
      <OwnerNav />
      <DemoBanner />
      {children}
    </PageMain>
  );
}
