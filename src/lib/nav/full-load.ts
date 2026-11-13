import { DATA_IMAGE_PATHS } from "@/lib/security/data-image-paths";

/**
 * Whether `href` is a page that shows the QR as a `data:` image (P2-1 T-12). The CSP is chosen per fully loaded document and an
 * App Router client navigation keeps the first document's, so such a page must be reached by a full document load.
 */
export function needsFullLoad(href: string): boolean {
  const raw = href.split(/[?#]/, 1)[0] ?? "";
  // A trailing slash reaches the same page (Next redirects it), so it is the same QR page.
  const path = raw.length > 1 ? raw.replace(/\/+$/, "") : raw;
  return DATA_IMAGE_PATHS.includes(path);
}

/** Moves to `href`: a full document load for a QR page, the router's replace for everything else. */
export function navigateTo(router: { replace: (href: string) => void }, href: string): void {
  if (needsFullLoad(href)) window.location.assign(href);
  else router.replace(href);
}
