"use client";

import { useCallback, useEffect, useState } from "react";
import { apiJson } from "@/lib/api/client";

const FORBIDDEN = 403;

/**
 * Loads one /api/rules/* list and the caller's role, and saves one record at a time with a PATCH. The server decides
 * everything (what each role sees, whether a save is valid, the words of an error); this only keeps the state of a
 * screen: the data, a shared "Salvato" note, and one error per record.
 */
export function useRules<List>(path: string) {
  const [data, setData] = useState<List | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const result = await apiJson<List>(path);
    if (!result.ok) {
      if (result.status === FORBIDDEN) setForbidden(true);
      else setError(result.error.message);
      return false;
    }
    setError(null);
    setData(result.data);
    return true;
  }, [path]);

  useEffect(() => {
    // Loading the list and the role when the page opens is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    void apiJson<{ user: { role: string } }>("/api/me").then((me) => {
      if (me.ok) setRole(me.data.user.role);
    });
  }, [load]);

  /** Sends one PATCH for the record `id`; on success reloads the list so the screen shows what the server holds. */
  const save = useCallback(
    async (id: string, url: string, body: unknown) => {
      setBusyId(id);
      setSaved(false);
      setErrors((current) => {
        const { [id]: _removed, ...rest } = current;
        return rest;
      });
      const result = await apiJson(url, { method: "PATCH", body });
      if (!result.ok) {
        setErrors((current) => ({ ...current, [id]: result.error.message }));
      } else if (await load()) {
        setSaved(true);
      }
      setBusyId(null);
    },
    [load],
  );

  return { data, role, forbidden, error, errors, busyId, saved, save };
}
