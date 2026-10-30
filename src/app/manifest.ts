import type { MetadataRoute } from "next";

// The web manifest (M20 plan §3.6.6). Only the approved trading name and the two brand colours of docs/client-facts.md (green and
// cream). No `icons` until the logo is approved (Q121): the phone shows a generic icon, and the app works offline without installing.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Osteria Dei Rossi",
    short_name: "Osteria Dei Rossi",
    lang: "it",
    start_url: "/",
    scope: "/",
    display: "standalone",
    theme_color: "#1C4130",
    background_color: "#FFFADF",
  };
}
