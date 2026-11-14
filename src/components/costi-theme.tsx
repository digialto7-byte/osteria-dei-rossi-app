// The Costì look switch (ADR-042, ADR-045). `:root:has([data-brand="costi"])` in globals.css re-values every colour and font token for the whole
// page while this marker is in it, so the header band above follows too. A hidden span, not a wrapper: `:has()` matches hidden elements, and the
// page's children stay direct children of `main` (the `.reveal` stagger keeps working). A server component, so the server states the attribute
// and nothing flashes. A route group's `layout.tsx` renders it; P2j makes Costì the default and deletes it.
export function CostiTheme() {
  return <span data-brand="costi" hidden />;
}
