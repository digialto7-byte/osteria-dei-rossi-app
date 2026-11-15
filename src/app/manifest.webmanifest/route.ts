import { webManifest } from "@/lib/brand/manifest";

// The same URL, body and headers Next.js gave the root `manifest.ts` metadata file. A route handler, not a metadata file: Next links a
// root metadata manifest into every page, the console's included, and the console must not offer the app for install (SP3 step 16).
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(JSON.stringify(webManifest()), {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
