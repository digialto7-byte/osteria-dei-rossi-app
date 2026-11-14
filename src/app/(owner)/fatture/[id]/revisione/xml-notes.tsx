import { Card, SubHeading } from "@/components/ui";
import { t } from "@/lib/i18n";

/**
 * "Nel file c'è anche": what the file held that Costì did not import. Plain words from the server, never a warning colour (nothing is
 * wrong; the owner should know). Absent when there is nothing to say.
 */
export function XmlNotes({ notes }: { notes: { code: string; label: string }[] }) {
  if (notes.length === 0) return null;
  return (
    <Card className="flex flex-col gap-2">
      <SubHeading>{t("review.xml.notesTitle")}</SubHeading>
      <ul className="flex list-disc flex-col gap-1 pl-5">
        {notes.map((note) => (
          <li key={note.code} className="[overflow-wrap:anywhere]">
            {note.label}
          </li>
        ))}
      </ul>
    </Card>
  );
}
