const LOWERCASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** SP3 step 19 (plan §3.7): the venue «Entra nel locale» asked for, only as one lowercase uuid; anything else is ignored. It only orders and marks the list. */
export function highlightOf(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && LOWERCASE_UUID.test(value) ? value : undefined;
}
