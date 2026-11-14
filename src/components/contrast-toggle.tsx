"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { t } from "@/lib/i18n";

// The device's single contrast key, shared by /cucina, /tavoli and the comanda (P3 Sala, D4). The name stays as the kitchen first saved it.
const STORAGE_KEY = "kitchen.contrast";

/**
 * "Alto contrasto": a pressed/unpressed secondary button (pressed: sunk fill and a check mark, never the primary). The page puts data-contrast="high" on its root when it is pressed, and
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
    <Button variant="secondary" aria-pressed={high} data-on={high} onClick={() => onToggle(!high)}>
      {high && (
        <span aria-hidden="true" className="mr-1.5">
          ✓
        </span>
      )}
      {t("contrast.toggle")}
    </Button>
  );
}

function stored(): "high" | "normal" | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "high" || value === "normal" ? value : null;
  } catch {
    // Product requirement (P3 Sala D4): a browser that refuses storage has no saved choice, so the device's preference decides.
    return null;
  }
}

/**
 * The mode of this device. A UI preference in localStorage, not data: the person's choice wins; with none, the device's
 * "prefers-contrast: more" turns it on. Read after mount so the server and the first client render agree.
 */
export function useDeviceContrast(): [boolean, (next: boolean) => void] {
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
      // Product requirement (P3 Sala D4): a browser that refuses storage keeps the choice for this visit only.
    }
  };
  return [high, set];
}
