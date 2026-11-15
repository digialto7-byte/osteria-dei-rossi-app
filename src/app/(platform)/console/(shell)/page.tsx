import { Suspense } from "react";
import { LocaliScreen } from "@/components/console/locali-screen";

/** Locali. The screen reads the address (sort, search), so it sits under a Suspense boundary. */
export default function ConsoleHomePage() {
  return (
    <Suspense>
      <LocaliScreen />
    </Suspense>
  );
}
