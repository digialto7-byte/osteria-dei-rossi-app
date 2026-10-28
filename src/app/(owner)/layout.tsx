import type { ReactNode } from "react";
import { DemoBanner } from "./demo-banner";
import { OwnerNav } from "./owner-nav";

export default function OwnerLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <OwnerNav />
      <DemoBanner />
      {children}
    </>
  );
}
