"use client";

import { useState } from "react";

/**
 * The "Fornitore aggiunto." line under a form: set after a save, cleared as soon as the form is edited again, so it
 * never describes a form that has changed since.
 */
export function useSuccessNote() {
  const [note, setNote] = useState<string | null>(null);
  return { note, show: setNote, clear: () => setNote(null) };
}
