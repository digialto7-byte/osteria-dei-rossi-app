"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { t } from "@/lib/i18n";

const STORAGE_KEY = "kitchen.contrast";

/**
 * "Alto contrasto": a pressed/unpressed button. The page puts data-contrast="high" on its root when it is pressed, and
 * globals.css does the rest (ink instead of grey, 2 px borders, larger names and quantities).
 */
export function ContrastToggle({
  high,
  onToggle,
}: {
  high: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <Button
      variant={high ? "primary" : "secondary"}
      aria-pressed={high}
      onClick={() => onToggle(!high)}
    >
      {t("kitchen.contrast")}
    </Button>
  );
}

function stored(): "high" | "normal" | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "high" || value === "normal" ? value : null;
  } catch {
    return null;
  }
}

/**
 * The mode of this device. A UI preference in localStorage, not data: the cook's choice wins; with none, the device's
 * "prefers-contrast: more" turns it on. Read after mount so the server and the first client render agree.
 */
export function useKitchenContrast(): [boolean, (next: boolean) => void] {
  const [high, setHigh] = useState(false);
  useEffect(() => {
    const choice = stored();
    const asked =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-contrast: more)").matches;
    // Reading the device's saved choice once, after mount, is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHigh(choice === null ? asked : choice === "high");
  }, []);
  const set = (next: boolean) => {
    setHigh(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "high" : "normal");
    } catch {
      // A browser that refuses storage keeps the choice for this visit only.
    }
  };
  return [high, set];
}
