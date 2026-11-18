import type { ReactNode } from "react";
import { CostiTheme } from "@/components/costi-theme";

// DoppiaVerifica wears the Costì look from P2h (ADR-045). The marker re-values the colour and font tokens for the whole page, the header band
// included; the page stays a direct child of `main` so its `.reveal` stagger keeps working.
export default function DoppiaVerificaLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <CostiTheme />
      {children}
    </>
  );
}
