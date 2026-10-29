"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui";

/**
 * Whether an "Aggiungi …" form is showing (UX plan P2-1). Until the user chooses, the form is closed when the list has
 * rows (the list comes first) and open when the list is empty (nothing to see, so the form is the next step). While the
 * list is loading (`null`) it stays closed, so a form never flashes in and out. Once the user opens or closes it, the
 * user's choice wins.
 */
export function useCollapsibleAdd(itemCount: number | null) {
  const [chosen, setChosen] = useState<boolean | null>(null);
  return {
    open: chosen ?? itemCount === 0,
    show: () => setChosen(true),
    hide: () => setChosen(false),
  };
}

const FIRST_FIELD = "input:not([type=hidden]), select, textarea";

/** The "Aggiungi …" button, or the form it stands for. Tapping the button focuses the form's first field. */
export function CollapsibleAdd({
  label,
  open,
  onShow,
  children,
}: {
  label: string;
  open: boolean;
  onShow: () => void;
  children?: ReactNode;
}) {
  const body = useRef<HTMLDivElement>(null);
  // Only a tap moves the focus; a form that starts open (empty list) leaves it where it is.
  const focusWhenOpen = useRef(false);

  useEffect(() => {
    if (!open || !focusWhenOpen.current) return;
    focusWhenOpen.current = false;
    body.current?.querySelector<HTMLElement>(FIRST_FIELD)?.focus();
  }, [open]);

  if (!open) {
    return (
      <Button
        variant="secondary"
        aria-expanded={false}
        onClick={() => {
          focusWhenOpen.current = true;
          onShow();
        }}
      >
        {label}
      </Button>
    );
  }
  return <div ref={body}>{children}</div>;
}
