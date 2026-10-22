import type { ReactNode } from "react";
import { Badge, Button, LedgerList, LedgerRow } from "@/components/ui";
import { lineBadges, lineMeta } from "@/lib/invoices/review-view";
import { t } from "@/lib/i18n";
import { formatQty } from "@/lib/units";
import type { ReviewLine } from "@/server/invoices/review-types";

interface LineRowProps {
  line: ReviewLine;
  /** Gives the row its "Modifica" button; absent on a read-only invoice. */
  onEdit?: () => void;
  expanded?: boolean;
  /** The open editor, shown under the row. */
  editor?: ReactNode;
  /** How each part of a split line is drawn; by default as a plain row. */
  renderChild?: (child: ReviewLine) => ReactNode;
}

/**
 * One extracted line: the description, a `.num` meta line, the ingredient it will add to, the
 * words it carries (badges) and, when editable, the "Modifica" button. Display only: the order,
 * highlights and base quantity all come from the server.
 */
export function LineRow({ line, onEdit, expanded = false, editor, renderChild }: LineRowProps) {
  const badges = lineBadges(line);
  const nested = line.parentLineId !== null;
  return (
    <LedgerRow data-testid="review-line" data-line-id={line.id}>
      <div className="flex flex-col items-start gap-1.5 py-3">
        <p className="font-bold [overflow-wrap:anywhere]">
          {nested && (
            <span className="font-normal text-ink-muted">{`${t("review.partOf", { n: line.subPosition })} · `}</span>
          )}
          {line.rawDescription}
        </p>
        <p className="num text-sm [overflow-wrap:anywhere] text-ink-muted">{lineMeta(line)}</p>
        {line.ingredient && (
          <p className="text-sm [overflow-wrap:anywhere]">
            {t("review.ingredient", { name: line.ingredient.name })}
            {line.baseQty && (
              <>
                {" · "}
                <span className="num">
                  {t("review.baseQty", { qty: formatQty(line.baseQty.qty, line.baseQty.unit) })}
                </span>
              </>
            )}
          </p>
        )}
        {badges.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {badges.map((badge) => (
              <Badge key={badge.id} tone={badge.tone} data-badge={badge.id}>
                {badge.text}
              </Badge>
            ))}
          </div>
        )}
        {onEdit && (
          <Button
            variant="secondary"
            aria-expanded={expanded}
            aria-label={t("review.editLine", { name: line.rawDescription })}
            onClick={onEdit}
          >
            {t("review.edit")}
          </Button>
        )}
        {editor}
      </div>
      {line.children && line.children.length > 0 && (
        <div className="mb-3 ml-3 border-l-2 border-rule pl-3">
          <LedgerList>
            {line.children.map((child) =>
              renderChild ? renderChild(child) : <LineRow key={child.id} line={child} />,
            )}
          </LedgerList>
        </div>
      )}
    </LedgerRow>
  );
}
