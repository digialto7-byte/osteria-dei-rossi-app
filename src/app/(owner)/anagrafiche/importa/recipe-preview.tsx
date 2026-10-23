import { Badge, Button, Checkbox, LedgerList, LedgerRow } from "@/components/ui";
import { t } from "@/lib/i18n";
import type { RecipeImportResult } from "@/server/recipes/import";

/** The import starts as a preview: nothing is saved until the user has seen the list. */
export const INITIAL_DRY_RUN = true;

export function RecipeImportOptions({
  dryRun,
  onChange,
}: {
  dryRun: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <Checkbox
      label={t("import.dryRun")}
      checked={dryRun}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

const ACTION_TONE = { create: "success", new_version: "info", unchanged: "neutral" } as const;

const actionText = (action: RecipeImportResult["recipes"][number]) =>
  t(`import.recipeAction.${action.action}`, { version: action.version });

/**
 * What the import did, or would do: one row per recipe with the action in words, then the counts.
 * A preview says nothing was saved and offers the real import; the database produced the list by
 * running the import and rolling it back, so it is exact.
 */
export function RecipePreview({
  result,
  busy,
  onConfirm,
}: {
  result: RecipeImportResult;
  busy: boolean;
  onConfirm: () => void;
}) {
  const counts = {
    created: result.created,
    newVersions: result.newVersions,
    unchanged: result.unchanged,
  };
  return (
    <section className="flex flex-col gap-3">
      <p className="num font-bold">
        {t(result.dryRun ? "import.previewCounts" : "import.recipesDone", counts)}
      </p>
      {result.dryRun && <p className="text-ink-muted">{t("import.previewNote")}</p>}
      <LedgerList>
        {result.recipes.map((recipe) => (
          <LedgerRow key={`${recipe.row}-${recipe.name}`} className="flex flex-col gap-1.5 py-3">
            <span className="font-bold [overflow-wrap:anywhere]">{recipe.name}</span>
            <Badge tone={ACTION_TONE[recipe.action]}>{actionText(recipe)}</Badge>
            {recipe.warnings.map((warning) => (
              <p key={`${warning.line}-${warning.code}`} className="text-sm text-ink-muted">
                {t("import.recipeWarning", { line: warning.line })}
              </p>
            ))}
          </LedgerRow>
        ))}
      </LedgerList>
      {result.dryRun && (
        <div>
          <Button disabled={busy} onClick={onConfirm}>
            {t("import.confirm")}
          </Button>
        </div>
      )}
    </section>
  );
}
