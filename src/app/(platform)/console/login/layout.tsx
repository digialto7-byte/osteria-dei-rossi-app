import type { ReactNode } from "react";
import { ConsoleBand } from "@/components/console/console-band";
import { PageMain } from "@/components/page-main";
import { ProductLogo } from "@/components/product-logo";

// The sign-in, code and enrolment pages: the console band without «Esci» (nobody is signed in yet, or the page has its own), the product logo,
// and no sidebar. The signed-in screens are in the (shell) group, so these pages never read /api/platform/*.
export default function ConsoleLoginLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ConsoleBand account={null} />
      <PageMain>
        <ProductLogo />
        {children}
      </PageMain>
    </>
  );
}
