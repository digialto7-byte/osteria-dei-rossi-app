import type { SupabaseClient } from "@supabase/supabase-js";
import { mapCountDbError } from "./errors";
import { countLinesResponse } from "./output";
import type { CountLinesBody } from "./schemas";
import type { CountLineEntry } from "./types";

/**
 * PUT /api/counts/:id/lines: enters or clears lines. public.count_record_lines takes the stock lock, reads the
 * location total and stores it as the expected quantity of each line; nothing is posted until the close.
 */
export async function saveCountLines(
  supabase: SupabaseClient,
  id: string,
  body: CountLinesBody,
): Promise<{ lines: CountLineEntry[] }> {
  const { data, error } = await supabase.rpc("count_record_lines", {
    p_session: id,
    p_lines: body.lines.map((line) => ({
      ingredient_id: line.ingredientId,
      qty: line.qty,
      unit: line.unit,
    })),
  });
  if (error) throw mapCountDbError(error);
  const result = data as { lines: CountLineEntry[] };
  return countLinesResponse.parse({
    lines: result.lines.map((l) => ({
      ingredientId: l.ingredientId,
      expectedQty: l.expectedQty,
      countedQty: l.countedQty,
      differenceQty: l.differenceQty,
      enteredAt: l.enteredAt,
    })),
  });
}
