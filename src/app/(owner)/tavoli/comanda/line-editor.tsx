"use client";

import { useState } from "react";
import { Button, Field, Select, TextInput } from "@/components/ui";
import { t } from "@/lib/i18n";
import { canDecrease, canIncrease, halfPressed, nextQty, toggleHalf } from "@/lib/orders/line-form";
import { courseLabel, qtyText } from "@/lib/orders/order-view";
import { COURSES, NOTE_MAX, type Course } from "@/server/orders/constants";
import type { OrderLine } from "@/server/orders/output";

export type LineChanges = Partial<{
  qty: number;
  course: Course;
  segue: boolean;
  isShared: boolean;
  note: string;
}>;

/**
 * The editor of a draft line: quantity in whole portions, "Mezza porzione", the course (a move), "Segue", "Piatto
 * condiviso", the note (sent when the field loses focus) and "Rimuovi". Each control reports one change; the page
 * turns it into one PATCH. Nothing is priced or counted here.
 */
export function LineEditor({
  line,
  busy,
  onChange,
  onRemove,
  onDone,
}: {
  line: OrderLine;
  busy: boolean;
  onChange: (changes: LineChanges) => void;
  onRemove: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState(line.note ?? "");
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-rule bg-sunk p-3">
      <div className="flex items-center gap-3" role="group" aria-label={t("orders.editor.qty")}>
        <Button
          variant="secondary"
          aria-label={t("orders.editor.less")}
          disabled={busy || !canDecrease(line.qty)}
          onClick={() => onChange({ qty: nextQty(line.qty, -1) })}
        >
          −
        </Button>
        <span className="num min-w-10 text-center text-lg font-bold">{qtyText(line.qty)}</span>
        <Button
          variant="secondary"
          aria-label={t("orders.editor.more")}
          disabled={busy || !canIncrease(line.qty)}
          onClick={() => onChange({ qty: nextQty(line.qty, 1) })}
        >
          +
        </Button>
        <Button
          variant={halfPressed(line.qty) ? "primary" : "secondary"}
          aria-pressed={halfPressed(line.qty)}
          disabled={busy}
          onClick={() => onChange({ qty: toggleHalf(line.qty) })}
        >
          {t("orders.editor.half")}
        </Button>
      </div>
      <Field label={t("orders.editor.course")}>
        <Select
          value={line.course}
          disabled={busy}
          onChange={(event) => onChange({ course: event.target.value as Course })}
        >
          {COURSES.map((course) => (
            <option key={course} value={course}>
              {courseLabel(course)}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex flex-wrap gap-3">
        <Button
          variant={line.segue ? "primary" : "secondary"}
          aria-pressed={line.segue}
          disabled={busy}
          onClick={() => onChange({ segue: !line.segue })}
        >
          {t("orders.editor.segue")}
        </Button>
        <Button
          variant={line.isShared ? "primary" : "secondary"}
          aria-pressed={line.isShared}
          disabled={busy}
          onClick={() => onChange({ isShared: !line.isShared })}
        >
          {t("orders.editor.shared")}
        </Button>
      </div>
      <Field label={t("orders.editor.note")} hint={t("orders.editor.noteHint")}>
        <TextInput
          value={note}
          maxLength={NOTE_MAX}
          disabled={busy}
          onChange={(event) => setNote(event.target.value)}
          onBlur={() => onChange({ note })}
        />
      </Field>
      <div className="flex flex-wrap gap-3">
        <Button variant="danger" disabled={busy} onClick={onRemove}>
          {t("orders.editor.remove")}
        </Button>
        <Button disabled={busy} onClick={onDone}>
          {t("orders.editor.done")}
        </Button>
      </div>
    </div>
  );
}
