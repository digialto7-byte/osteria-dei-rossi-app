import { Button } from "@/components/ui";
import { t } from "@/lib/i18n";
import type { Undo } from "@/lib/kitchen/kitchen-done";

/**
 * The notice after a comanda closes (by itself or with "Chiudi comanda"): what happened, and one button that takes it back. No
 * confirm dialog anywhere in the kitchen: every mistake is undone with a tap. The page decides how long it stays.
 */
export function UndoNotice({
  undo,
  onUndo,
  disabled,
}: {
  undo: Undo | null;
  onUndo: () => void;
  disabled: boolean;
}) {
  if (!undo) return null;
  return (
    <div
      role="status"
      className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-card border border-rule bg-sunk p-4 shadow-lg"
    >
      <span className="text-lg font-bold [overflow-wrap:anywhere]">{undo.text}</span>
      <Button variant="secondary" disabled={disabled} onClick={onUndo}>
        {t("kitchen.undo")}
      </Button>
    </div>
  );
}
