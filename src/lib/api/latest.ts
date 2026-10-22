/**
 * For a screen that fires requests as the user types or picks: each `start()` returns a check that
 * says whether that request is still the newest. A response is applied only if its check is true,
 * so a slow old answer can never replace a newer one.
 */
export function latestOnly(): () => () => boolean {
  let newest = 0;
  return () => {
    const mine = ++newest;
    return () => mine === newest;
  };
}
