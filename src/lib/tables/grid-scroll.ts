// Where the grid of tables was scrolled to when the waiter tapped an occupied table, so "‹ Tavoli" or the back button returns to the same
// place (P2b-7, plan D12). One value per tab (sessionStorage), taken once: a later visit to /tavoli starts at the top.

const KEY = "tavoli.scroll";

/**
 * Remembers the vertical offset. sessionStorage can be refused (private mode, a policy); then nothing is remembered and the grid opens at
 * the top, which is the documented fallback: the grid still works and no figure is invented.
 */
export function saveGridScroll(offset: number): void {
  if (!Number.isFinite(offset) || offset < 0) return;
  try {
    window.sessionStorage.setItem(KEY, String(Math.round(offset)));
  } catch {
    // Refused storage: the fallback above, not a failure of the screen.
  }
}

/** The remembered offset, once; null when nothing is saved, the value is not a number, or the storage is refused. */
export function takeGridScroll(): number | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    if (raw === null || !/^\d+$/.test(raw)) return null;
    return Number(raw);
  } catch {
    // Refused storage: the grid opens at the top.
    return null;
  }
}

/** How long the restore follows a page that is still growing. Past that the grid stays where it is. */
const FOLLOW_MS = 3000;
/** A waiter's own scroll or key ends the restore at once: it never fights the hand. */
const USER_INPUT = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

/**
 * Scrolls the grid back to `offset`. The page can still grow after its first render with tiles (a grid row, a banner, a notice), and a
 * single scrollTo is then clamped to the shorter page. So the restore follows the page's size until it can reach the offset, and stops
 * there, at the waiter's first input, or after FOLLOW_MS, whichever comes first. Returns a stop for the caller's cleanup.
 */
export function restoreGridScroll(offset: number): () => void {
  const reachable = () => document.documentElement.scrollHeight - window.innerHeight >= offset;
  let stopped = false;
  let observer: ResizeObserver | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    observer?.disconnect();
    if (timer !== null) clearTimeout(timer);
    for (const type of USER_INPUT) window.removeEventListener(type, stop);
  };
  const follow = () => {
    if (stopped) return;
    window.scrollTo(0, offset);
    if (reachable()) stop();
  };
  window.scrollTo(0, offset);
  if (reachable()) return stop;
  observer = new ResizeObserver(follow);
  observer.observe(document.documentElement);
  timer = setTimeout(stop, FOLLOW_MS);
  for (const type of USER_INPUT) window.addEventListener(type, stop, { passive: true });
  return stop;
}
