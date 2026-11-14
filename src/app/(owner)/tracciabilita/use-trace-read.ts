"use client";

import { useEffect, useState } from "react";
import { apiJson } from "@/lib/api/client";
import { t } from "@/lib/i18n";

/**
 * Reads one trace reply when the page opens. `message` is the sentence for a failed read: the role's no (403), an unknown id (404) or the
 * API's own words. The reply is whatever /api/trace/* sent; nothing is computed from it here.
 */
export function useTraceRead<T>(path: string): { data: T | null; message: string | null } {
  const [state, setState] = useState<{ data: T | null; message: string | null }>({
    data: null,
    message: null,
  });
  useEffect(() => {
    let live = true;
    void apiJson<T>(path).then((result) => {
      if (!live) return;
      if (result.ok) return setState({ data: result.data, message: null });
      const message =
        result.status === 403
          ? t("trace.forbidden")
          : result.status === 404
            ? t("traceError.not_found")
            : result.error.message;
      setState({ data: null, message });
    });
    return () => {
      live = false;
    };
  }, [path]);
  return state;
}
