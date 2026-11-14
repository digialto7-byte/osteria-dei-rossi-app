// Test-only helpers that build small FatturaPA-shaped XML (fake data, no client facts).

export const NS_FPR = "http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2";
export const NS_SEMPLIFICATA = "http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.0";
export const NS_DSIG = "http://www.w3.org/2000/09/xmldsig#";

export const DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

/** A root element in the FatturaPA namespace with an optional prefix, around `inner`. */
export function root(
  inner: string,
  options: { prefix?: string | null; versione?: string; extraAttrs?: string } = {},
): string {
  const { prefix = "p", versione = "FPR12", extraAttrs = "" } = options;
  const name = prefix ? `${prefix}:FatturaElettronica` : "FatturaElettronica";
  const xmlns = prefix ? `xmlns:${prefix}="${NS_FPR}"` : `xmlns="${NS_FPR}"`;
  return `${DECLARATION}\n<${name} ${xmlns} versione="${versione}"${extraAttrs ? ` ${extraAttrs}` : ""}>${inner}</${name}>`;
}

export const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

/** `levels` nested <a> elements. */
export const nested = (levels: number): string => "<a>".repeat(levels) + "</a>".repeat(levels);
