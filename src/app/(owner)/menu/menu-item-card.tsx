import { Badge, Button, Card } from "@/components/ui";
import { badgesFor, courseWord, priceLine } from "@/lib/menu/menu-view";
import { t } from "@/lib/i18n";
import type { MenuItem } from "@/server/menu/output";

/**
 * One menu item for the owner: the name, the price line ("14,00 € · IVA 10 %") and the course, the flags (Senza
 * ricetta, Ricetta disattivata, Non disponibile, Non attivo) and "Modifica". Every word and the price string come
 * from the server's item through the view helpers; nothing is computed here. A name is rendered as text.
 */
export function MenuItemCard({ item, onEdit }: { item: MenuItem; onEdit: () => void }) {
  const badges = badgesFor(item);
  return (
    <Card
      role="group"
      aria-label={item.name}
      data-menu-item-id={item.id}
      className="flex flex-col gap-2"
    >
      <p className="text-lg font-bold [overflow-wrap:anywhere]">{item.name}</p>
      <p className="num">{priceLine(item.price, item.vatRate)}</p>
      <p className="text-sm text-ink-muted">{courseWord(item.course)}</p>
      {item.recipeName && (
        <p className="text-sm text-ink-muted [overflow-wrap:anywhere]">
          {t("menu.recipeLine", { name: item.recipeName })}
        </p>
      )}
      {badges.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {badges.map((badge) => (
            <Badge key={badge.id} tone={badge.tone}>
              {badge.label}
            </Badge>
          ))}
        </div>
      )}
      <Button variant="secondary" onClick={onEdit} className="self-start">
        {t("menu.edit")}
      </Button>
    </Card>
  );
}
