/**
 * The only page paths that may show the QR as a `data:` image (P2-1 T-12): the forced enrolment, the owner's offer (its "Attiva ora"
 * opens the enrolment in place) and the factor list. The CSP is chosen per fully loaded document, so every way into one of these
 * pages must be a full document load (see `src/lib/nav/full-load.ts`).
 */
export const DATA_IMAGE_PATHS: readonly string[] = [
  "/login/attiva-codice",
  "/login/offerta-codice",
  "/doppia-verifica",
];
