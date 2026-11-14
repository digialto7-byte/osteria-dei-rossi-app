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
