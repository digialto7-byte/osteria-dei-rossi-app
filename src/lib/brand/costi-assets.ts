// The logo slots of the Costì product brand (docs/plans/2026-11-13-costi-product-brand.md §3.5, §3.6). This is the only file in src/ that
// names the files under public/brand/costi/. The founder's logo files replace the files, never these names, so the swap edits no code.
// The PNGs are rendered from the SVG slots by `npx tsx scripts/brand/render-icons.ts`, which reads COSTI_PNGS for their names and sizes.

const FOLDER = "/brand/costi";
const url = (file: string) => `${FOLDER}/${file}`;

/** The nine SVG slots, as public paths. */
export const COSTI_SVG = {
  appIcon: url("app-icon.svg"),
  appIconMaskable: url("app-icon-maskable.svg"),
  favicon: url("favicon.svg"),
  logoHorizontal: url("logo-horizontal.svg"),
  logoHorizontalReversed: url("logo-horizontal-reversed.svg"),
  /** Reserved: no consumer yet. */
  mark: url("mark.svg"),
  markReversed: url("mark-reversed.svg"),
  wordmark: url("wordmark.svg"),
  wordmarkReversed: url("wordmark-reversed.svg"),
} as const;

export const COSTI_SVGS: readonly string[] = Object.values(COSTI_SVG);

export interface CostiPng {
  /** The file name inside public/brand/costi/. */
  file: string;
  /** The public path. */
  url: string;
  /** The SVG slot (file name) it is rendered from. */
  source: string;
  /** Width and height in pixels (all are square). */
  size: number;
  /** The manifest `purpose` of the icon. */
  purpose: "any" | "maskable";
}

const png = (
  file: string,
  source: string,
  size: number,
  purpose: "any" | "maskable",
): CostiPng => ({
  file,
  url: url(file),
  source,
  size,
  purpose,
});

/** The six generated PNGs: manifest icons, the apple-touch icon and the favicon fallback. */
export const COSTI_ICONS = {
  icon192: png("icon-192.png", "app-icon.svg", 192, "any"),
  icon512: png("icon-512.png", "app-icon.svg", 512, "any"),
  appleTouch: png("apple-touch-icon.png", "app-icon.svg", 180, "any"),
  maskable192: png("icon-maskable-192.png", "app-icon-maskable.svg", 192, "maskable"),
  maskable512: png("icon-maskable-512.png", "app-icon-maskable.svg", 512, "maskable"),
  favicon32: png("favicon-32.png", "favicon.svg", 32, "any"),
} as const;

export const COSTI_PNGS: readonly CostiPng[] = Object.values(COSTI_ICONS);
