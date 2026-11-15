import type { ReactNode } from "react";
import { CostiTheme } from "@/components/costi-theme";

// Spingere wears the Costì look from P2d (ADR-045). The marker re-values the colour and font tokens for the whole page, the header band
// included; the page stays a direct child of `main` so its `.reveal` stagger keeps working.
export default function SpingereLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <CostiTheme />
      {children}
    </>
  );
}
