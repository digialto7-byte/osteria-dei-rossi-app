"use client";

import { useCallback, useEffect, useState } from "react";
import { apiJson } from "@/lib/api/client";

/** Loads a list endpoint, with a toggle for deactivated rows and a reload after changes. */
export function useApiList<Item>(path: string, key: string) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const reload = useCallback(async () => {
    const separator = path.includes("?") ? "&" : "?";
    const result = await apiJson<Record<string, Item[]>>(
      `${path}${separator}active=${showInactive ? "all" : "true"}`,
    );
    if (result.ok) {
      setItems(result.data[key] ?? []);
      setError(null);
    } else {
      setError(result.error.message);
    }
  }, [path, key, showInactive]);

  useEffect(() => {
    // Fetching on mount and when the filter changes is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  return { items, error, setError, reload, showInactive, setShowInactive };
}
