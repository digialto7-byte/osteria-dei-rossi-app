import type { ReactNode } from "react";
import { OwnerNav } from "./owner-nav";

export default function OwnerLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <OwnerNav />
      {children}
    </>
  );
}
