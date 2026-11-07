"use client";

import { t } from "@/lib/i18n";

// Next.js 16 pre-renders this as /_global-error, its fallback for a server error, and it must draw its own <html> and
// <body>. Its scripts carry no nonce, so the nonce policy blocks them (it fails closed, ADR-028): everything the person
// needs is therefore plain markup. The link home and the reload hint work with no JavaScript; the retry button is an
// extra and is never the only way out. The error itself is not shown (it may hold internals).
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="it">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          margin: "2rem auto",
          maxWidth: "28rem",
          padding: "0 1rem",
        }}
      >
        <main>
          <h1>{t("globalError.title")}</h1>
          <p>{t("globalError.text")}</p>
          <p>{t("globalError.reloadHint")}</p>
          <p>
            {/* A plain anchor on purpose: next/link needs the router, which is not there when this renders. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/">{t("globalError.home")}</a>
          </p>
          <button type="button" onClick={() => reset()}>
            {t("globalError.retry")}
          </button>
        </main>
      </body>
    </html>
  );
}
