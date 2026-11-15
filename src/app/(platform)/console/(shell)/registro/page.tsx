import { Suspense } from "react";
import { RegistroScreen } from "@/components/console/registro-screen";

/** The platform audit. The screen reads the address (filters), so it sits under a Suspense boundary. */
export default function RegistroPage() {
  return (
    <Suspense>
      <RegistroScreen />
    </Suspense>
  );
}
