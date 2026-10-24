/**
 * Runs a request and hands back its value only if no newer request started meanwhile (`start` is the function made by
 * `latestOnly()`); an answer that was overtaken comes back as null. A count screen asks again after every save, and
 * answers can arrive out of order: the older one must not replace the newer counters.
 */
export async function fetchNewest<T>(
  start: () => () => boolean,
  fetcher: () => Promise<T>,
): Promise<T | null> {
  const isNewest = start();
  const value = await fetcher();
  return isNewest() ? value : null;
}
